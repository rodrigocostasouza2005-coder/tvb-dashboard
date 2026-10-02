import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { createDapicClients, stripReferenciaPrefix, parseDapicDateTime, stableItemIndexes, isGarrafaBrinde, waitMsFromDapicError, sleep, mapWithConcurrency, parseTabelaPrecosLabel, type DapicClient } from "@/lib/connectors/dapic";
// (import type { Prisma } removido abaixo — já importado acima como valor+tipo)
import { displayGroupFor, sellsProducts } from "@/lib/connectors/armazenadores";
import { upsertStockSnapshots, type StockSnapshotRow } from "@/lib/connectors/upsert-stock";
import { upsertProductionOrders, type ProductionOrderRow } from "@/lib/connectors/upsert-production-order";
import { fetchPriceCatalogCached, inferTabelaPreco, type PriceCatalog } from "@/lib/connectors/tabela-preco";
import { sendTelegramMessage } from "@/lib/telegram";
import { getTopParaIncentivar, getTopVendidosPorLoja, getPromotionRows, getB2BClienteNomes, classifySaleChannel } from "@/lib/metrics";
import { brasiliaDayStart, brasiliaDayEnd, todayBrasiliaStr } from "@/lib/filters";

// Lógica compartilhada pelas duas rotas de sync (/api/sync e /api/sync-evening) — precisam ser
// arquivos de rota separados (paths diferentes) porque o plano Hobby da Vercel só permite um
// cron job rodando 1x/dia CADA, e dois crons apontando pro mesmo path deixavam o registro deles
// num estado ambíguo (a sync da manhã simplesmente parou de disparar).

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function syncArmazenadores(client: DapicClient) {
  const armazenadores = await client.fetchArmazenadores();
  const storeByDapicId = new Map<number, string>();
  let primaryStoreId: string | null = null;
  let atacadoStoreId: string | null = null;

  for (const a of armazenadores) {
    const existing = await prisma.store.findFirst({
      where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] },
    });
    const sells = sellsProducts(a.Descricao);
    const group = displayGroupFor(a.Descricao);
    const store = existing
      ? await prisma.store.update({
          // Bug real achado em 2026-09-23: esse update nunca reescrevia "sellsProducts", então um
          // valor errado gravado uma vez (ex: ATACADO com false) ficava preso pra sempre mesmo
          // depois da regra em sellsProducts() já calcular certo — corrigido incluindo o campo
          // aqui, igual o create já fazia.
          where: { id: existing.id },
          data: { dapicArmazenadorId: a.Id, displayGroup: group, sellsProducts: sells },
        })
      : await prisma.store.create({
          data: {
            code: a.Descricao,
            name: a.Descricao === "CD" ? "TVB Site e Atacado" : a.Descricao,
            dapicArmazenadorId: a.Id,
            sellsProducts: sells,
            displayGroup: group,
          },
        });
    storeByDapicId.set(a.Id, store.id);
    if (sells && !primaryStoreId) primaryStoreId = store.id;
    if (a.Descricao === "ATACADO") atacadoStoreId = store.id;
  }

  return { storeByDapicId, primaryStoreId, atacadoStoreId };
}

async function syncEstoque(client: DapicClient, storeByDapicId: Map<number, string>) {
  const linhas = await client.fetchEstoqueTodosArmazenadores();
  const data: StockSnapshotRow[] = [];
  for (const l of linhas) {
    const storeId = storeByDapicId.get(l.IdArmazenador);
    if (!storeId) continue;
    data.push({
      storeId,
      cod: String(l.IdGradeProduto),
      produto: stripReferenciaPrefix(l.Produto),
      grupo: l.Grupo ?? "(sem grupo)",
      cor: l.Cor ?? null,
      tamanho: l.Tamanho ?? null,
      colecao: l.Colecao ?? null,
      quantidadeDisponivel: l.QuantidadeReal ?? l.Quantidade ?? 0,
      estoqueMinimo: null,
      valorCusto: l.ValorCusto ?? null,
    });
  }
  if (data.length) await upsertStockSnapshots(prisma, data);
  return data.length;
}

// Pro token cd-atacado, vendaspdv só tem devolução de verdade — a venda do canal Site+Atacado
// vem de /faturas (confirmado com Rodrigo em 2026-08-10). As linhas "Venda" que aparecem aqui
// pra esse token são só o lado de troca (pareada com uma devolução), não a venda real — ignora.
//
// Bug real achado em 2026-09-23: pra esse token, tudo (inclusive devolução real de atacado) era
// gravado sempre na loja "site" (storeId/primaryStoreId=CD) — a loja ATACADO só recebia estoque,
// nunca venda/devolução, então produto de atacado aparecia misturado em "TVB Site e Atacado".
// Corrigido: quando `atacadoStoreId` existe (só acontece pro token cd-atacado), cada linha escolhe
// a loja pela tabelaPreco já inferida (mesmo sinal que já era usado só pro filtro de canal B2B/B2C).
// Preço pago que não bate com nenhuma tabela do catálogo (null) é comum em pedido de atacado com
// preço negociado (ver comentário em canalWhere/classifySaleChannel, core.ts). Antes isso ficava
// "perdido" como null e vazava pro filtro de "Tabela varejo" na Visão Geral (saleWhere trata null
// como "passa junto" em qualquer tabela selecionada). Delega pra classifySaleChannel — a MESMA
// função que decide canal em qualquer outro lugar do projeto — em vez de reimplementar a regra
// aqui; só traduz o resultado de volta pro formato de string que o campo tabelaPreco espera. Só
// se aplica quando atacadoStoreId existe (só pro token cd-atacado — física não tem esse canal,
// confirmado com o Rodrigo em 2026-09-30).
function inferTabelaPrecoComFallbackCliente(
  cod: string,
  valorUnitario: number,
  catalog: PriceCatalog,
  clienteNome: string | null,
  b2bClientes: Set<string>
): string | null {
  const inferido = inferTabelaPreco(cod, valorUnitario, catalog);
  if (inferido !== null) return inferido;
  const classificacao = classifySaleChannel(inferido, clienteNome, b2bClientes);
  return classificacao.channel === "B2B" ? "Tabela atacado" : null;
}

async function syncVendas(
  client: DapicClient,
  storeId: string | null,
  atacadoStoreId: string | null,
  dias: number,
  priceCatalog: PriceCatalog
) {
  if (!storeId) return { vendas: 0, devolucoes: 0, brindes: 0, vendedorCorrigido: [] as VendedorCorrigido[] };
  const siteStoreId: string = storeId;
  const contaVendaDoPdv = client.label !== "cd-atacado";
  const b2bClientes = atacadoStoreId ? await getB2BClienteNomes() : new Set<string>();
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - dias);
  const vendasPdv = await client.fetchVendasPdv(toDateStr(inicio), toDateStr(hoje));

  const saleData: Prisma.SaleCreateManyInput[] = [];
  const returnData: Prisma.ReturnCreateManyInput[] = [];
  const giftData: Prisma.GiftCreateManyInput[] = [];

  // atacadoStoreId só vem preenchido pro token cd-atacado — nos outros (loja física), sempre cai
  // em `storeId` (comportamento igual ao de antes).
  function resolveStoreId(tabelaPreco: string | null): string {
    return tabelaPreco === "Tabela atacado" && atacadoStoreId ? atacadoStoreId : siteStoreId;
  }

  // Tabela de preço REAL por venda (ver parseTabelaPrecosLabel, dapic.ts) — 1 chamada extra por
  // venda fechada com item de Venda/Devolução, buscada com concorrência limitada (volume medido em
  // 2026-10-01: no máximo ~30 vendas distintas/loja num dia, então nem um limite baixo vira
  // gargalo de tempo). Pulado pra vendas que só têm Brinde (tabelaPreco não é usado ali).
  const vendasComItemRelevante = vendasPdv.filter(
    (v) =>
      v.Status === "Fechada" &&
      v.DataFechamento &&
      v.Produtos.some((item) => (item.Tipo === "Venda" && contaVendaDoPdv) || item.Tipo === "Devolução")
  );
  const tabelaPrecoRealPorVenda = new Map<number, string | null>(
    await mapWithConcurrency(vendasComItemRelevante, 8, async (v) => {
      const detalhe = await client.fetchVendaPdvDetalhe(v.Id).catch(() => null);
      return [v.Id, parseTabelaPrecosLabel(detalhe?.TabelaPrecos)] as const;
    })
  );

  for (const venda of vendasPdv) {
    if (venda.Status !== "Fechada" || !venda.DataFechamento) continue;
    const saleDate = parseDapicDateTime(venda.DataFechamento);

    // Índice determinístico pelo CONTEÚDO dos itens, não pelo item.Id da API (instável — ver
    // stableItemIndexes em dapic.ts). Calculado sobre a venda inteira (Venda+Devolução+Brinde
    // juntos): cada Tipo grava numa tabela diferente, então não colide entre si mesmo
    // compartilhando o índice.
    const itemIndexes = stableItemIndexes(
      venda.Produtos,
      (p) => `${p.IdGradeProduto ?? venda.Codigo}::${p.Quantidade}::${p.ValorLiquido.toFixed(2)}::${p.Tipo}`
    );

    venda.Produtos.forEach((item, pos) => {
      const itemIndex = itemIndexes[pos];
      const cod = item.IdGradeProduto != null ? String(item.IdGradeProduto) : venda.Codigo;
      if (item.Tipo === "Venda" && contaVendaDoPdv) {
        const tabelaPreco =
          tabelaPrecoRealPorVenda.get(venda.Id) ??
          inferTabelaPrecoComFallbackCliente(cod, item.ValorUnitario, priceCatalog, venda.Cliente ?? null, b2bClientes);
        saleData.push({
          storeId: resolveStoreId(tabelaPreco),
          dapicVendaId: venda.Id,
          itemIndex,
          cod,
          produto: item.Produto,
          grupo: item.Grupo ?? "(sem grupo)",
          cor: item.Cor ?? null,
          tamanho: item.Tamanho ?? null,
          marca: item.Marca ?? null,
          colecao: item.Colecao ?? null,
          clienteNome: venda.Cliente ?? null,
          vendedor: venda.Vendedor ?? null,
          cidade: venda.Cidade?.Nome ?? null,
          estado: venda.Cidade?.Estado ?? null,
          quantidade: item.Quantidade,
          valorTotalLiquido: isGarrafaBrinde(item.Produto) ? 0 : item.ValorLiquido,
          tabelaPreco,
          codigo: venda.Codigo ?? null,
          saleDate,
        });
      } else if (item.Tipo === "Devolução") {
        const tabelaPreco =
          tabelaPrecoRealPorVenda.get(venda.Id) ??
          inferTabelaPrecoComFallbackCliente(cod, item.ValorUnitario, priceCatalog, venda.Cliente ?? null, b2bClientes);
        returnData.push({
          storeId: resolveStoreId(tabelaPreco),
          dapicVendaId: venda.Id,
          itemIndex,
          cod,
          produto: item.Produto,
          grupo: item.Grupo ?? "(sem grupo)",
          cor: item.Cor ?? null,
          tamanho: item.Tamanho ?? null,
          marca: item.Marca ?? null,
          colecao: item.Colecao ?? null,
          tabelaPreco,
          quantidade: item.Quantidade,
          valorTotal: item.ValorLiquido,
          returnDate: saleDate,
        });
      } else if (item.Tipo === "Brinde") {
        giftData.push({
          storeId,
          dapicVendaId: venda.Id,
          itemIndex,
          cod,
          produto: item.Produto,
          grupo: item.Grupo ?? "(sem grupo)",
          cor: item.Cor ?? null,
          tamanho: item.Tamanho ?? null,
          marca: item.Marca ?? null,
          colecao: item.Colecao ?? null,
          clienteNome: venda.Cliente ?? null,
          quantidade: item.Quantidade,
          valorTotalLiquido: item.ValorLiquido,
          giftDate: saleDate,
        });
      }
    });
  }

  // Idempotente em cima de (storeId, dapicVendaId, itemIndex) — o cron roda 2x/dia olhando sempre
  // "últimos N dias", então as janelas se sobrepõem. Brinde continua com createMany + skipDuplicates
  // (sem campo conhecido que precise de correção depois). Venda usa upsert em massa que ATUALIZA o
  // "vendedor" no conflito, em vez de só pular — achado em 2026-09-01 (Rodrigo): a loja às vezes
  // bate a venda com um vendedor e corrige quem atendeu de verdade DEPOIS no DAPIC (ex: Ingrid
  // registrou uma venda que era da Thye Mattos, cliente do Alexander); sem atualizar, ficávamos
  // travados no vendedor errado pra sempre depois da 1ª sync daquela venda. Devolução usa o mesmo
  // padrão de upsert pra "colecao" — ver upsertReturnsComColecaoAtualizavel acima (achado 2026-10-01,
  // auditoria de Data Quality).
  const storeIdsPossiveis = atacadoStoreId ? [siteStoreId, atacadoStoreId] : [siteStoreId];
  await resolveStoreIdsEstaveis(prisma.sale, saleData as { dapicVendaId: number; itemIndex: number; storeId: string }[], storeIdsPossiveis);
  await resolveStoreIdsEstaveis(prisma.return, returnData as { dapicVendaId: number; itemIndex: number; storeId: string }[], storeIdsPossiveis);

  const vendedorCorrigido = await upsertSalesComVendedorAtualizavel(saleData);
  await upsertReturnsComColecaoAtualizavel(returnData);
  if (giftData.length) await prisma.gift.createMany({ data: giftData, skipDuplicates: true });
  return { vendas: saleData.length, devolucoes: returnData.length, brindes: giftData.length, vendedorCorrigido };
}

// Preserva o storeId já gravado pra um item (dapicVendaId+itemIndex) já visto antes, mesmo que a
// classificação de canal mude numa sync futura (preço reclassificado no catálogo, cliente virando
// B2B confirmado via CNPJ, etc). Sem isso, o storeId calculado por resolveStoreId (derivado e
// portanto mutável) podia divergir entre duas sincronizações do MESMO item — e como a chave de
// idempotência (storeId, dapicVendaId, itemIndex) inclui justamente o storeId, isso não colidia
// com nada: o item era inserido DE NOVO sob o novo storeId, duplicando a venda.
//
// Bug real achado em 2026-10-01: fatura NITHI (Id 11473, 52 itens) e PROS (Id 11472, 44 itens)
// duplicadas exatamente assim — sincronizadas 1ª vez (storeId=CD) antes do commit 87ead95
// (CNPJ passou a contar como sinal de B2B), e de novo (storeId=ATACADO) numa sync horas depois,
// já com o commit no ar e o cliente reclassificado. R$20.076,08 de venda duplicada até ser achado.
//
// Só precisa consultar quando há mais de 1 storeId candidato (atacadoStoreId existe, só pro
// token cd-atacado) — nos outros clientes resolveStoreId sempre devolve o mesmo valor, sem risco.
type EstavelFindMany = (args: {
  where: { storeId: { in: string[] }; dapicVendaId: { in: number[] } };
  select: { dapicVendaId: true; itemIndex: true; storeId: true };
}) => Promise<{ dapicVendaId: number | null; itemIndex: number | null; storeId: string }[]>;

async function resolveStoreIdsEstaveis<T extends { dapicVendaId: number; itemIndex: number; storeId: string }>(
  model: { findMany: EstavelFindMany },
  items: T[],
  storeIdsPossiveis: string[]
): Promise<void> {
  if (items.length === 0 || storeIdsPossiveis.length < 2) return;
  const dapicVendaIds = [...new Set(items.map((i) => i.dapicVendaId))];
  const existentes = await model.findMany({
    where: { storeId: { in: storeIdsPossiveis }, dapicVendaId: { in: dapicVendaIds } },
    select: { dapicVendaId: true, itemIndex: true, storeId: true },
  });
  const storeIdExistente = new Map(existentes.map((e) => [`${e.dapicVendaId}::${e.itemIndex}`, e.storeId]));
  for (const item of items) {
    const existente = storeIdExistente.get(`${item.dapicVendaId}::${item.itemIndex}`);
    if (existente) item.storeId = existente;
  }
}

type VendedorCorrigido = {
  clienteNome: string | null;
  produto: string;
  saleDate: Date;
  vendedorAntigo: string | null;
  vendedorNovo: string | null;
};

// Upsert em massa: insere venda nova normalmente, e no conflito (venda já sincronizada antes) só
// atualiza o campo "vendedor" — ver comentário acima em syncVendas. Detecta e devolve os casos
// onde o vendedor realmente mudou (não toda venda já existente, só as que tiveram correção de
// verdade), pra entrar no resumo do Telegram.
export async function upsertSalesComVendedorAtualizavel(saleData: Prisma.SaleCreateManyInput[]): Promise<VendedorCorrigido[]> {
  if (saleData.length === 0) return [];
  // storeId não é mais único no lote (cd-atacado agora espalha venda entre loja site e atacado,
  // ver resolveStoreId em syncVendas) — filtrar só pelas lojas que aparecem, senão a busca abaixo
  // ignorava a "vendedor antigo" de metade do lote.
  const storeIds = [...new Set(saleData.map((s) => s.storeId as string))];
  const dapicVendaIds = [...new Set(saleData.map((s) => s.dapicVendaId as number))];

  const existentes = await prisma.sale.findMany({
    where: { storeId: { in: storeIds }, dapicVendaId: { in: dapicVendaIds } },
    select: { dapicVendaId: true, itemIndex: true, vendedor: true },
  });
  const vendedorAntigoPorChave = new Map(existentes.map((e) => [`${e.dapicVendaId}::${e.itemIndex}`, e.vendedor]));

  const values = saleData.map(
    (s) => Prisma.sql`(
      ${randomUUID()}, ${s.storeId}, ${s.cod}, ${s.produto}, ${s.grupo}, ${s.cor ?? null}, ${s.tamanho ?? null},
      ${s.colecao ?? null}, ${s.marca ?? null}, ${s.clienteNome ?? null}, ${s.vendedor ?? null}, ${s.tabelaPreco ?? null},
      ${s.cidade ?? null}, ${s.estado ?? null}, ${s.quantidade}, ${s.valorTotalLiquido}, ${s.saleDate},
      ${s.dapicVendaId}, ${s.itemIndex}
    )`
  );

  await prisma.$executeRaw`
    INSERT INTO "Sale" (
      "id", "storeId", "cod", "produto", "grupo", "cor", "tamanho",
      "colecao", "marca", "clienteNome", "vendedor", "tabelaPreco",
      "cidade", "estado", "quantidade", "valorTotalLiquido", "saleDate",
      "dapicVendaId", "itemIndex"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("storeId", "dapicVendaId", "itemIndex") DO UPDATE SET
      "vendedor" = EXCLUDED."vendedor"
  `;

  const corrigidos: VendedorCorrigido[] = [];
  for (const s of saleData) {
    const antigo = vendedorAntigoPorChave.get(`${s.dapicVendaId}::${s.itemIndex}`);
    if (antigo !== undefined && antigo !== null && antigo !== s.vendedor) {
      corrigidos.push({
        clienteNome: s.clienteNome as string | null,
        produto: s.produto as string,
        saleDate: s.saleDate as Date,
        vendedorAntigo: antigo,
        vendedorNovo: s.vendedor as string | null,
      });
    }
  }
  return corrigidos;
}

// Bug real achado em 2026-10-01 (auditoria de Data Quality, pedido do Rodrigo): 98.9% das
// devoluções do banco ficavam com colecao=null, inclusive sincronizadas há poucos dias — não era
// "dado antigo de antes do campo existir" como o comentário antigo deste arquivo assumia. Causa
// raiz: /vendaspdv devolve Colecao preenchida pra linha de Devolução (confirmado reconsultando a
// API ao vivo pros mesmos registros que estavam null no banco — a informação SEMPRE existiu na
// origem), mas createMany+skipDuplicates trata Return como imutável desde a 1ª sincronização —
// se a API devolveu Colecao=null na primeira vez que o sync viu aquela devolução (ex: campo ainda
// não propagado no backend do DAPIC naquele instante), ficava null PRA SEMPRE, mesmo depois da
// API corrigir. Mesmo padrão de upsert já usado pra "vendedor" em Sale (ver função acima) —
// atualiza colecao no conflito, mas só quando o valor novo não é null (nunca regride um dado bom
// pra null se uma sync futura vier com o campo vazio por qualquer motivo transiente).
async function upsertReturnsComColecaoAtualizavel(returnData: Prisma.ReturnCreateManyInput[]): Promise<void> {
  if (returnData.length === 0) return;
  const values = returnData.map(
    (r) => Prisma.sql`(
      ${randomUUID()}, ${r.storeId}, ${r.cod}, ${r.produto}, ${r.grupo}, ${r.cor ?? null}, ${r.tamanho ?? null},
      ${r.marca ?? null}, ${r.tabelaPreco ?? null}, ${r.colecao ?? null}, ${r.quantidade}, ${r.valorTotal},
      ${r.returnDate}, ${r.dapicVendaId}, ${r.itemIndex}
    )`
  );

  await prisma.$executeRaw`
    INSERT INTO "Return" (
      "id", "storeId", "cod", "produto", "grupo", "cor", "tamanho",
      "marca", "tabelaPreco", "colecao", "quantidade", "valorTotal",
      "returnDate", "dapicVendaId", "itemIndex"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("storeId", "dapicVendaId", "itemIndex") DO UPDATE SET
      "colecao" = COALESCE(EXCLUDED."colecao", "Return"."colecao")
  `;
}

// Venda de verdade do canal Site+Atacado (só cd-atacado tem acesso a /faturas). Mesma chave de
// idempotência (storeId, dapicVendaId=Id da fatura, itemIndex) — nunca colide com vendaspdv
// porque esse token não grava mais Sale via vendaspdv (ver syncVendas).
//
// Bug real achado em 2026-09-23: toda fatura (site E atacado) caía sempre na loja "site" — ver
// comentário em syncVendas. Mesma correção aqui: fatura com tabelaPreco="Tabela atacado" vai pra
// loja ATACADO.
async function syncFaturas(
  client: DapicClient,
  storeId: string | null,
  atacadoStoreId: string | null,
  dias: number,
  priceCatalog: PriceCatalog
) {
  if (!storeId || client.label !== "cd-atacado") return { vendas: 0, brindes: 0 };
  const b2bClientes = atacadoStoreId ? await getB2BClienteNomes() : new Set<string>();
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - dias);
  const faturas = await client.fetchFaturas(toDateStr(inicio), toDateStr(hoje));

  const saleData: Prisma.SaleCreateManyInput[] = [];
  const giftData: Prisma.GiftCreateManyInput[] = [];
  for (const fatura of faturas) {
    if (fatura.Status !== "Fechado" || !fatura.DataFechamento) continue;
    const saleDate = parseDapicDateTime(fatura.DataFechamento);
    const produtos = await client.fetchFaturaProdutos(fatura.Id);
    // Tabela de preço REAL da fatura inteira (ver parseTabelaPrecosLabel, dapic.ts) — 1 chamada
    // extra por fatura, mas o volume de faturas/dia é pequeno (medido em 2026-10-01: no máximo
    // ~2-20/dia pro Site+Atacado). Se a chamada falhar (raro), cai pro heurístico antigo
    // (inferTabelaPrecoComFallbackCliente) só pra essa fatura, em vez de derrubar a sync inteira.
    const detalhe = await client.fetchFaturaDetalhe(fatura.Id).catch(() => null);
    const tabelaPrecoReal = parseTabelaPrecosLabel(detalhe?.TabelaPrecos);
    const itemIndexes = stableItemIndexes(
      produtos,
      (p) => `${p.IdGradeProduto}::${p.Quantidade}::${p.Valores.ValorTotal.toFixed(2)}::${p.Tipo}`
    );

    produtos.forEach((item, pos) => {
      const itemIndex = itemIndexes[pos];
      if (item.Tipo === "Brinde") {
        giftData.push({
          storeId,
          dapicVendaId: fatura.Id,
          itemIndex,
          cod: String(item.IdGradeProduto),
          produto: stripReferenciaPrefix(item.Produto),
          grupo: item.Grupo ?? "(sem grupo)",
          cor: item.Cor ?? null,
          tamanho: item.Tamanho ?? null,
          marca: item.Marca ?? null,
          colecao: item.Colecao ?? null,
          clienteNome: fatura.Cliente ?? null,
          quantidade: item.Quantidade,
          valorTotalLiquido: item.Valores.ValorTotal,
          giftDate: saleDate,
        });
        return;
      }
      if (item.Tipo !== "Venda") return;
      const tabelaPreco =
        tabelaPrecoReal ??
        inferTabelaPrecoComFallbackCliente(
          String(item.IdGradeProduto),
          item.Valores.ValorUnitario,
          priceCatalog,
          fatura.Cliente ?? null,
          b2bClientes
        );
      saleData.push({
        storeId: tabelaPreco === "Tabela atacado" && atacadoStoreId ? atacadoStoreId : storeId,
        dapicVendaId: fatura.Id,
        itemIndex,
        cod: String(item.IdGradeProduto),
        produto: stripReferenciaPrefix(item.Produto),
        grupo: item.Grupo ?? "(sem grupo)",
        cor: item.Cor ?? null,
        tamanho: item.Tamanho ?? null,
        marca: item.Marca ?? null,
        colecao: item.Colecao ?? null,
        clienteNome: fatura.Cliente ?? null,
        cidade: fatura.Cidade ?? null,
        estado: fatura.Estado ?? null,
        quantidade: item.Quantidade,
        // item.Produto ainda tem a referência colada ("XXX - Garrafa...") nesse endpoint — isGarrafaBrinde
        // precisa do nome já stripado (stripReferenciaPrefix), senão o startsWith nunca bate aqui.
        valorTotalLiquido: isGarrafaBrinde(stripReferenciaPrefix(item.Produto)) ? 0 : item.Valores.ValorTotal,
        tabelaPreco,
        codigo: fatura.Codigo ?? null,
        saleDate,
      });
    });
  }
  if (giftData.length) await prisma.gift.createMany({ data: giftData, skipDuplicates: true });

  if (atacadoStoreId) {
    await resolveStoreIdsEstaveis(prisma.sale, saleData as { dapicVendaId: number; itemIndex: number; storeId: string }[], [storeId, atacadoStoreId]);
  }
  if (saleData.length) await prisma.sale.createMany({ data: saleData, skipDuplicates: true });
  return { vendas: saleData.length, brindes: giftData.length };
}

// Janela de reconciliação de cancelamento — não é "quantos dias de venda processar" (isso
// continua sendo 1, ver syncOneClient), é "quantos dias pra trás vale a pena reconferir se algo
// que já foi sincronizado mudou de status". 7 dias: folga generosa sobre os casos reais
// observados numa auditoria em 2026-10-01 (cancelamentos aconteceram em até ~2 dias do
// fechamento original) — ver reconciliarCancelamentos abaixo.
const RECONCILIACAO_DIAS = 7;

// Achado em 2026-10-01 (pedido do Rodrigo, auditoria de consistência): o sync normal só processa
// venda com Status "Fechada"/"Fechado" dentro da janela de 1 dia — se o DAPIC cancelar uma venda
// DEPOIS dela já ter sido sincronizada, o sync nunca revisita essa linha (e pior: ao cancelar, a
// API volta DataFechamento pra null, então nem dá pra usar "ainda tem DataFechamento" como pista).
// Medido ao vivo: 12 faturas já canceladas no DAPIC continuavam como Sale válida, R$4.442,30.
//
// Reconciliação: busca de novo, numa janela mais larga (RECONCILIACAO_DIAS), só o que foi
// MODIFICADO (`FiltrarPor: "Modificacao"`, não documentado antes — ver DataModificacao em
// dapic.ts) — pega cancelamento de venda cujo fechamento original já saiu da janela normal de 1
// dia. Só atualiza (nunca insere/deleta): se o item nunca foi "Fechada" pra começo de conversa,
// nunca virou Sale, não tem o que reconciliar. status/canceladaEm usam a MESMA chave de
// idempotência (storeId, dapicVendaId, itemIndex) já usada pelo resto do sync — recalculada com
// stableItemIndexes() igual a inserção original, senão o updateMany nunca acha a linha certa.
// Só marca Cancelada (não tenta reverter um cancelamento de volta pra Fechada automaticamente —
// caso não observado nos dados reais auditados; se acontecer, precisa de correção manual).
export function isStatusCancelada(status: string): boolean {
  return status === "Cancelada" || status === "Cancelado";
}

export async function reconciliarCancelamentosVendas(
  client: DapicClient,
  storeId: string | null,
  atacadoStoreId: string | null,
  // Parametrizável só pro backfill único (scripts/backfill-cancelamentos.ts, histórico completo)
  // — o sync normal sempre usa o default (RECONCILIACAO_DIAS, janela operacional de 7 dias).
  diasAtras = RECONCILIACAO_DIAS
): Promise<{ saleUpdates: number; returnUpdates: number }> {
  if (!storeId) return { saleUpdates: 0, returnUpdates: 0 };
  const storeIdsPossiveis = atacadoStoreId ? [storeId, atacadoStoreId] : [storeId];
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - diasAtras);
  const vendas = await client.fetchVendasPdvModificadas(toDateStr(inicio), toDateStr(hoje));

  let saleUpdates = 0;
  let returnUpdates = 0;
  for (const venda of vendas) {
    if (!isStatusCancelada(venda.Status)) continue;
    const itemIndexes = stableItemIndexes(
      venda.Produtos,
      (p) => `${p.IdGradeProduto ?? venda.Codigo}::${p.Quantidade}::${p.ValorLiquido.toFixed(2)}::${p.Tipo}`
    );
    for (let pos = 0; pos < venda.Produtos.length; pos++) {
      const item = venda.Produtos[pos];
      const itemIndex = itemIndexes[pos];
      if (item.Tipo === "Venda") {
        const r = await prisma.sale.updateMany({
          where: { storeId: { in: storeIdsPossiveis }, dapicVendaId: venda.Id, itemIndex, status: { not: "Cancelada" } },
          data: { status: "Cancelada", canceladaEm: new Date() },
        });
        saleUpdates += r.count;
      } else if (item.Tipo === "Devolução") {
        const r = await prisma.return.updateMany({
          where: { storeId: { in: storeIdsPossiveis }, dapicVendaId: venda.Id, itemIndex, status: { not: "Cancelada" } },
          data: { status: "Cancelada", canceladaEm: new Date() },
        });
        returnUpdates += r.count;
      }
    }
  }
  return { saleUpdates, returnUpdates };
}

// Mesma lógica que reconciliarCancelamentosVendas, mas pro canal Site+Atacado (/faturas) — só
// cd-atacado tem acesso. Faturas não têm Return (devolução desse canal vem só de /vendaspdv, ver
// syncVendas), então só atualiza Sale.
export async function reconciliarCancelamentosFaturas(
  client: DapicClient,
  storeId: string | null,
  atacadoStoreId: string | null,
  diasAtras = RECONCILIACAO_DIAS
): Promise<{ saleUpdates: number }> {
  if (!storeId || client.label !== "cd-atacado") return { saleUpdates: 0 };
  const storeIdsPossiveis = atacadoStoreId ? [storeId, atacadoStoreId] : [storeId];
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - diasAtras);
  const faturas = await client.fetchFaturasModificadas(toDateStr(inicio), toDateStr(hoje));

  let saleUpdates = 0;
  for (const fatura of faturas) {
    if (!isStatusCancelada(fatura.Status)) continue;
    const produtos = await client.fetchFaturaProdutos(fatura.Id);
    const itemIndexes = stableItemIndexes(
      produtos,
      (p) => `${p.IdGradeProduto}::${p.Quantidade}::${p.Valores.ValorTotal.toFixed(2)}::${p.Tipo}`
    );
    for (let pos = 0; pos < produtos.length; pos++) {
      const item = produtos[pos];
      if (item.Tipo !== "Venda") continue;
      const itemIndex = itemIndexes[pos];
      const r = await prisma.sale.updateMany({
        where: { storeId: { in: storeIdsPossiveis }, dapicVendaId: fatura.Id, itemIndex, status: { not: "Cancelada" } },
        data: { status: "Cancelada", canceladaEm: new Date() },
      });
      saleUpdates += r.count;
    }
  }
  return { saleUpdates };
}

// Ordem de produção (token "matriz", separado das 4 lojas físicas — não vende nada, só dá acesso
// a esse endpoint). Volume é pequeno (~2300 linhas, 82 ordens desde 2025-08-22, testado em
// 2026-08-10: não existe nada mais antigo que isso), então busca o histórico completo a cada
// sync em vez de janela — mais simples e garante que status de ordens antigas ainda abertas
// (EmProducao/AguardandoInicio) seja atualizado quando finalizarem, sem depender de acertar o
// campo certo de filtro de data da API.
const ORDENS_PRODUCAO_DATA_INICIAL = "2018-01-01";

// Clientes — 1 token basta (cd-atacado enxerga todos). Range amplo pra pegar cadastros novos
// e atualizar dados (ex: troca de telefone) sem precisar de janela deslizante.
async function syncClientes(client: DapicClient) {
  const DATA_INICIAL = "2020-01-01";
  const dataFinal = toDateStr(new Date());
  const clientesRaw = await client.fetchClientes(DATA_INICIAL, dataFinal);
  // A API às vezes repete o mesmo Id na mesma resposta (achado em 2026-08-28, mesmo padrão já
  // visto em /ordensproducao/produtos) — sem dedupe, "ON CONFLICT DO UPDATE" quebra a sync
  // inteira porque a mesma linha apareceria 2x pra INSERT dentro do mesmo lote.
  const clientes = [...new Map(clientesRaw.map((c) => [c.Id, c])).values()];
  const BATCH = 500;
  let count = 0;
  for (let i = 0; i < clientes.length; i += BATCH) {
    const batch = clientes.slice(i, i + BATCH);
    const values = batch.map(
      (c) => Prisma.sql`(${randomUUID()}, ${c.Id}, ${c.NomeRazaoSocial}, ${c.Telefone ?? null}, ${c.Celular ?? null}, ${c.Email ?? null}, ${c.DataAniversario ? new Date(c.DataAniversario) : null}, ${c.CpfCnpj ?? null}, ${c.Funcionario ?? null})`
    );
    await prisma.$executeRaw`
      INSERT INTO "ClienteCadastro" ("id", "dapicId", "nome", "telefone", "celular", "email", "dataNascimento", "cpfCnpj", "vendedorResponsavel")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("dapicId") DO UPDATE SET
        "nome"                = EXCLUDED."nome",
        "telefone"            = EXCLUDED."telefone",
        "celular"             = EXCLUDED."celular",
        "email"               = EXCLUDED."email",
        "dataNascimento"      = EXCLUDED."dataNascimento",
        "cpfCnpj"             = EXCLUDED."cpfCnpj",
        "vendedorResponsavel" = EXCLUDED."vendedorResponsavel"
    `;
    count += batch.length;
  }
  return count;
}

async function syncParcelas(client: DapicClient) {
  // Busca só Status=Aberta desde 2024 — cobre inadimplência ativa sem histórico longo.
  // Trunca a tabela antes de reinserir: snapshot atual, não acúmulo histórico.
  const parcelas = await client.fetchParcelas("2024-01-01", toDateStr(new Date()), "Aberta");
  await prisma.parcela.deleteMany({});
  if (parcelas.length === 0) return 0;

  // Achado em 2026-09-14: a Inadimplência ficou zerada meses porque /contas/parcelas às vezes
  // manda data sem hora ("2025-09-22"), e uma linha assim derrubava o createMany do lote inteiro
  // (500 linhas boas descartadas por 1 ruim) — silencioso, porque Parcela nem tem SyncSource
  // próprio pra aparecer como falha na Visão Geral. parseDapicDateTime já trata data sem hora
  // agora, mas mantém esse filtro como cinto de segurança: pula só a linha realmente inválida
  // (data quebrada de outro jeito) em vez de descartar o lote todo de novo no futuro.
  const rowsValidas = parcelas.filter((p) => {
    const emissao = parseDapicDateTime(p.DataEmissao);
    const vencimento = parseDapicDateTime(p.DataVencimento);
    return !isNaN(emissao.getTime()) && !isNaN(vencimento.getTime());
  });
  if (rowsValidas.length < parcelas.length) {
    console.error(`[syncParcelas] ${parcelas.length - rowsValidas.length} parcela(s) com data inválida, ignoradas.`);
  }

  const BATCH = 500;
  let count = 0;
  for (let i = 0; i < rowsValidas.length; i += BATCH) {
    const batch = rowsValidas.slice(i, i + BATCH);
    const r = await prisma.parcela.createMany({
      data: batch.map((p) => ({
        idParcela: p.IdParcela,
        idConta: p.IdConta,
        status: p.Status,
        dataEmissao: parseDapicDateTime(p.DataEmissao),
        dataVencimento: parseDapicDateTime(p.DataVencimento),
        conta: p.Conta,
        formaPagamento: p.FormaPagamento,
        pessoa: p.Pessoa,
        numeroParcela: p.Parcela,
        valor: p.Valor,
        valorPago: p.ValorPago,
        valorAberto: p.ValorAberto,
        valorMulta: p.ValorMulta,
        valorJuros: p.ValorJuros,
        nossoNumeroBoleto: p.NossoNumeroBoleto ?? null,
        planoConta: p.PlanoConta ?? null,
      })),
      skipDuplicates: true,
    });
    count += r.count;
  }
  return count;
}

async function syncOrdensProducao(client: DapicClient | undefined) {
  if (!client) return 0;
  const linhas = await client.fetchOrdensProducaoProdutos(ORDENS_PRODUCAO_DATA_INICIAL, toDateStr(new Date()));
  // O DAPIC retorna múltiplas linhas para o mesmo (IdOrdemProducao, IdGradeProduto) com
  // quantidades parciais — precisamos SOMAR antes de upsertarmos (não sobrescrever).
  const aggregated = new Map<string, ProductionOrderRow>();
  for (const l of linhas.filter((l) => l.IdGradeProduto != null)) {
    const key = `${l.IdOrdemProducao}\x00${l.IdGradeProduto}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.quantidade += l.Quantidade;
      existing.quantidadeOriginal += l.QuantidadeOriginal;
      // Preferir colecao preenchida se uma das linhas tiver
      if (!existing.colecao && l.Colecao) existing.colecao = l.Colecao;
    } else {
      aggregated.set(key, {
        idOrdemProducao: l.IdOrdemProducao,
        cod: String(l.IdGradeProduto),
        ordemProducao: l.OrdemProducao,
        referencia: l.Referencia,
        produto: l.Produto,
        cor: l.Cor ?? null,
        tamanho: l.Tamanho ?? null,
        grupo: l.Grupo ?? "(sem grupo)",
        marca: l.Marca ?? null,
        colecao: l.Colecao ?? null,
        quantidade: l.Quantidade,
        quantidadeOriginal: l.QuantidadeOriginal,
        status: l.Status,
        dataFinalizacaoProducao: l.DataFinalizacaoProducao ? parseDapicDateTime(l.DataFinalizacaoProducao) : null,
        dataEntradaCelula: l.DataEntradaCelula ? parseDapicDateTime(l.DataEntradaCelula) : null,
      });
    }
  }
  return upsertProductionOrders(prisma, [...aggregated.values()]);
}

function formatProduto(pos: number, p: string, estoque: number, vendido: number) {
  return `${pos}. ${p} (estoque ${estoque}, vendeu ${vendido})`;
}

async function buildResumoMessage(desde: Date, ate: Date) {
  const [incentivar, porLoja] = await Promise.all([
    getTopParaIncentivar(30, 10),
    getTopVendidosPorLoja(desde, ate, 3),
  ]);

  const partes: string[] = [];

  if (incentivar.length) {
    partes.push(
      "\n📦 Top 10 pra incentivar (estoque parado, pouca venda nos últimos 30d):\n" +
        incentivar.map((p, i) => formatProduto(i + 1, p.produto, p.estoque, p.vendido)).join("\n")
    );
  }

  if (porLoja.length) {
    partes.push(
      "\n🏆 Mais vendidos por loja (dia de ontem):\n" +
        porLoja
          .map(
            (l) =>
              `${l.storeName}:\n` +
              l.produtos.map((p, i) => `  ${i + 1}. ${p.produto} (${p.quantidade})`).join("\n")
          )
          .join("\n")
    );
  }

  return partes.join("\n");
}

// Rede de segurança contra o incidente de 2026-09-25 (item.Id da DAPIC não é estável — ver
// stableItemIndexes em dapic.ts — causou ~R$800k em vendas duplicadas ao longo de vários
// reprocessamentos antes de ser achado por acidente). Roda 1x/dia (só na sync das 8h, ver
// checkDuplicates em runSyncLocked) e verifica se duplicata real reapareceu: mesma loja+venda+
// produto+quantidade+valor com mais de 1 linha — não deveria mais acontecer com o índice
// determinístico, mas mais vale checar sozinho do que descobrir de novo só quando o número já
// tiver errado na tela. Silencioso quando não acha nada, pra não virar ruído diário.
async function checkForDuplicateSales(): Promise<string | null> {
  const [saleGroups, returnGroups] = await Promise.all([
    prisma.sale.groupBy({
      by: ["storeId", "dapicVendaId", "cod", "quantidade", "valorTotalLiquido"],
      _count: { _all: true },
    }),
    prisma.return.groupBy({
      by: ["storeId", "dapicVendaId", "cod", "quantidade", "valorTotal"],
      _count: { _all: true },
    }),
  ]);

  const saleDupGroups = saleGroups.filter((g) => g._count._all > 1);
  const returnDupGroups = returnGroups.filter((g) => g._count._all > 1);
  if (saleDupGroups.length === 0 && returnDupGroups.length === 0) return null;

  const saleValorExtra = saleDupGroups.reduce((s, g) => s + g.valorTotalLiquido * (g._count._all - 1), 0);
  const returnValorExtra = returnDupGroups.reduce((s, g) => s + g.valorTotal * (g._count._all - 1), 0);

  const linhas: string[] = [];
  if (saleDupGroups.length) linhas.push(`Vendas: ${saleDupGroups.length} grupo(s) duplicado(s), ~R$ ${saleValorExtra.toFixed(0)} inflado`);
  if (returnDupGroups.length) linhas.push(`Devoluções: ${returnDupGroups.length} grupo(s) duplicado(s), ~R$ ${returnValorExtra.toFixed(0)} inflado`);
  return `⚠️ Duplicata de dado achada na checagem diária:\n${linhas.join("\n")}\nInvestigar antes de confiar nos números.`;
}

// Complemento financeiro ao "Top pra incentivar" (que é só unidades) — pedido do Rodrigo em
// 2026-09-28. Roda 1x/semana (segunda-feira, só na sync das 8h) e reaproveita a mesma regra de
// "Produtos que merecem atenção" da Análises de Promoção (valor de estoque alto + sell-through
// abaixo de 50%), pra destacar QUANTO dinheiro está parado, não só quantas unidades.
async function buildAlertaEstoqueParadoSemanal(): Promise<string | null> {
  const rows = await getPromotionRows({});
  const parados = rows
    .filter((r) => r.valorEstoqueCheio > 0 && r.sellThroughRate !== null && r.sellThroughRate < 50)
    .sort((a, b) => b.valorEstoqueCheio - a.valorEstoqueCheio)
    .slice(0, 10);
  if (parados.length === 0) return null;

  const totalParado = parados.reduce((s, r) => s + r.valorEstoqueCheio, 0);
  const linhas = parados.map(
    (r, i) =>
      `${i + 1}. ${r.produto} — R$ ${r.valorEstoqueCheio.toFixed(0)} parado (sell-through ${r.sellThroughRate?.toFixed(0)}%)`
  );
  return (
    `💰 Estoque parado da semana (top 10 por valor, sell-through < 50%):\n${linhas.join("\n")}\n` +
    `Total desses 10: R$ ${totalParado.toFixed(0)} — ver aba Análises de Promoção pra simular desconto.`
  );
}

// Um "attempt" da sync inteira — devolve o resumo em caso de sucesso, ou lança em caso de erro.
// Separado de runSync() pra permitir tentar de novo (retryBudgetMs) sem duplicar a lógica de
// notificação/log, que só acontece uma vez, no fim, em runSync().
async function doSync() {
  // "Mais vendidos por loja" olha o dia de ontem inteiro (00h-23h59 Brasília) — não mais
  // últimas 24h corridas nem "desde o último sync" (as duas versões anteriores podiam cair
  // majoritariamente numa janela de madrugada sem movimento das lojas físicas e mostrar só o
  // canal online. Rodrigo pediu "dia de ontem" fixo em 2026-08-12 pra sempre ser um dia
  // completo e comparável).
  const hojeBrasiliaStr = todayBrasiliaStr(new Date());
  const ontem = new Date(`${hojeBrasiliaStr}T00:00:00.000-03:00`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  const ontemStr = todayBrasiliaStr(ontem);
  const desde = brasiliaDayStart(ontemStr);
  const ate = brasiliaDayEnd(ontemStr);

  // "matriz" não vende nada (só existe pra dar acesso a /ordensproducao/produtos) — incluir ela
  // no loop de estoque/vendas abaixo duplicaria a busca de estoque das outras lojas (o token da
  // matriz enxerga tudo) e arriscaria timeout de novo à toa. Sincronizada à parte, em paralelo.
  const allClients = createDapicClients();
  const clients = allClients.filter((c) => c.label !== "matriz");
  const matrizClient = allClients.find((c) => c.label === "matriz");

  async function syncOneClient(client: DapicClient) {
    const { storeByDapicId, primaryStoreId, atacadoStoreId } = await syncArmazenadores(client);
    const [estoque, priceCatalog] = await Promise.all([
      syncEstoque(client, storeByDapicId),
      fetchPriceCatalogCached(prisma, client),
    ]);
    // Janela de 1 dia (24h) — cobre com folga o intervalo entre os 2 syncs diários (12h) e
    // reduz o volume processado (menos chamadas de /faturas, que é 1 por fatura pro
    // Site+Atacado). Se um sync falhar, o self-heal-sync.ts (dispara sozinho se o último
    // SyncLog tiver mais de 5h) cobre o risco de perder dado mais velho que essa janela.
    const vendas = await syncVendas(client, primaryStoreId, atacadoStoreId, 1, priceCatalog);
    const faturas = await syncFaturas(client, primaryStoreId, atacadoStoreId, 1, priceCatalog);
    // Não fatal: reconciliação é uma camada extra de correção, não pode derrubar o sync normal
    // (que já processou vendas/faturas novas com sucesso acima) se a API/rede falhar aqui.
    const canceladas = await Promise.all([
      reconciliarCancelamentosVendas(client, primaryStoreId, atacadoStoreId).catch((e) => {
        console.error(`[reconciliarCancelamentosVendas] ${client.label} falhou:`, e?.message ?? e);
        return { saleUpdates: 0, returnUpdates: 0 };
      }),
      reconciliarCancelamentosFaturas(client, primaryStoreId, atacadoStoreId).catch((e) => {
        console.error(`[reconciliarCancelamentosFaturas] ${client.label} falhou:`, e?.message ?? e);
        return { saleUpdates: 0 };
      }),
    ]);
    return {
      estoque,
      vendas: vendas.vendas + faturas.vendas,
      devolucoes: vendas.devolucoes,
      brindes: vendas.brindes + faturas.brindes,
      vendedorCorrigido: vendas.vendedorCorrigido,
      vendasCanceladas: canceladas[0].saleUpdates + canceladas[1].saleUpdates,
      devolucoesCanceladas: canceladas[0].returnUpdates,
    };
  }

  // cd-atacado (Site+Atacado, ~14k linhas de estoque, 3x maior que cada loja física) rodava em
  // paralelo com as outras 3 e travava todo mundo junto — medido em 2026-08-12: isolado leva
  // ~130s, mas junto com as outras 3 passava de 260s (quase estourando os 300s da Vercel), e as
  // 3 pequenas juntas SEM ela levam só ~87s (eram 126-200s cada rodando junto com ela). Parece
  // ser contenção real do lado do DAPIC quando os 4 tokens batem ao mesmo tempo, não só volume
  // de dado. Separado em duas fases sequenciais (cd-atacado sozinho, depois as 3 pequenas juntas)
  // — soma ~217s em vez de ~270-280s, com bem mais folga do limite.
  const cdAtacadoClient = clients.find((c) => c.label === "cd-atacado");
  const outrasLojas = clients.filter((c) => c.label !== "cd-atacado");

  // Escalona o 1º request de cada token (2s de intervalo) — só pesa quando o cache de token
  // (DapicTokenCache) está frio pros 5 de uma vez (1ª sync depois do deploy, ou depois de ~24h
  // quando todos os tokens expiram meio juntos), mas garante que os até 5 logins nunca disparem
  // no mesmo segundo, sobrando folga de verdade dentro do rate limit de 5/60s do DAPIC mesmo se
  // outra coisa (self-heal, Force Sync manual) acontecer no mesmo instante.
  const STAGGER_MS = 2_000;

  const [results, totalOrdensProducao, totalClientes] = await Promise.all([
    (async () => {
      const outrosResultados = await Promise.all(
        outrasLojas.map((client, i) => sleep(i * STAGGER_MS).then(() => syncOneClient(client)))
      );
      const cdResultado = cdAtacadoClient ? [await syncOneClient(cdAtacadoClient)] : [];
      return [...outrosResultados, ...cdResultado];
    })(),
    // Não fatal: se o token da matriz ainda não estiver configurado (ex: só em dev, não em
    // produção), syncOrdensProducao devolve 0 sem quebrar o resto da sync.
    sleep(outrasLojas.length * STAGGER_MS)
      .then(() => syncOrdensProducao(matrizClient))
      .catch((e) => { console.error("[syncOrdensProducao] falhou:", e?.message ?? e); return 0; }),
    // Clientes — 1 token basta, não é fatal se falhar
    sleep((outrasLojas.length + 1) * STAGGER_MS)
      .then(() => (cdAtacadoClient ? syncClientes(cdAtacadoClient) : Promise.resolve(0)))
      .catch(() => 0),
    // Parcelas em aberto (inadimplência) — não é fatal se falhar. Mesmo client que syncClientes
    // (cd-atacado), então não soma outro slot no escalonamento — o dedup de login concorrente
    // (loginPromise em DapicClient) já evita 2 logins pro mesmo token aqui.
    sleep((outrasLojas.length + 1) * STAGGER_MS)
      .then(() => (cdAtacadoClient ? syncParcelas(cdAtacadoClient) : Promise.resolve(0)))
      .catch((e) => { console.error("[syncParcelas] falhou:", e?.message ?? e); return 0; }),
  ]);

  const totalEstoque = results.reduce((a, r) => a + r.estoque, 0);
  const totalVendas = results.reduce((a, r) => a + r.vendas, 0);
  const totalDevolucoes = results.reduce((a, r) => a + r.devolucoes, 0);
  const totalBrindes = results.reduce((a, r) => a + r.brindes, 0);
  const totalVendasCanceladas = results.reduce((a, r) => a + r.vendasCanceladas, 0);
  const totalDevolucoesCanceladas = results.reduce((a, r) => a + r.devolucoesCanceladas, 0);
  const vendedorCorrigido = results.flatMap((r) => r.vendedorCorrigido);

  await prisma.syncLog.create({
    data: { source: "STOCK", status: "SUCCESS", recordsSynced: totalEstoque, finishedAt: new Date() },
  });
  await prisma.syncLog.create({
    data: { source: "SALES", status: "SUCCESS", recordsSynced: totalVendas, finishedAt: new Date() },
  });
  await prisma.syncLog.create({
    data: { source: "RETURNS", status: "SUCCESS", recordsSynced: totalDevolucoes, finishedAt: new Date() },
  });
  await prisma.syncLog.create({
    data: { source: "PRODUCTION", status: "SUCCESS", recordsSynced: totalOrdensProducao, finishedAt: new Date() },
  });
  await prisma.syncLog.create({
    data: { source: "GIFTS", status: "SUCCESS", recordsSynced: totalBrindes, finishedAt: new Date() },
  });

  return {
    lojas: clients.length,
    estoque: totalEstoque,
    vendas: totalVendas,
    devolucoes: totalDevolucoes,
    ordensProducao: totalOrdensProducao,
    brindes: totalBrindes,
    vendasCanceladas: totalVendasCanceladas,
    devolucoesCanceladas: totalDevolucoesCanceladas,
    vendedorCorrigido,
    desde,
    ate,
  };
}

// silent: não manda "✅ atualizado" no sucesso (usado nas syncs extra de 00h/12h — pedido do
// Rodrigo em 2026-08-24, essas são só rede de segurança, não precisa avisar todo mundo). Erro
// sempre avisa, mas só pro admin (TELEGRAM_ADMIN_CHAT_ID) — só o Rodrigo recebe erro, sucesso
// continua indo pra lista inteira (TELEGRAM_CHAT_ID).
// retryBudgetMs: se a 1ª tentativa falhar, tenta de novo até esse tempo total passar (uma sync
// completa já leva ~130-280s sozinha — maxDuration é 300s — então normalmente cabe só mais 1-2
// tentativas, não um número fixo; por isso o retry é por orçamento de tempo, não por contagem).
const SYNC_LOCK_ID = "sync";
const SYNC_LOCK_STALE_MIN = 6;

// Evita 2 sincronizações completas rodando ao mesmo tempo — virou risco real depois do
// agendador externo de 10 em 10 min (2026-09-11), já que uma sync completa pode levar até ~4min
// e meio num dia lento do DAPIC. "Travado" = já tem lock com finishedAt nulo E startedAt recente
// (dentro de SYNC_LOCK_STALE_MIN); depois disso considera stale (processo deve ter morrido sem
// atualizar finishedAt) e libera sozinho, pra nunca ficar preso pra sempre.
async function acquireSyncLock(): Promise<boolean> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - SYNC_LOCK_STALE_MIN * 60_000);
  const existing = await prisma.syncLock.findUnique({ where: { id: SYNC_LOCK_ID } });
  if (existing && existing.finishedAt === null && existing.startedAt > staleCutoff) {
    return false;
  }
  await prisma.syncLock.upsert({
    where: { id: SYNC_LOCK_ID },
    create: { id: SYNC_LOCK_ID, startedAt: now, finishedAt: null },
    update: { startedAt: now, finishedAt: null },
  });
  return true;
}

async function releaseSyncLock() {
  await prisma.syncLock.update({ where: { id: SYNC_LOCK_ID }, data: { finishedAt: new Date() } }).catch(() => {});
}

export async function runSync(options: { silent?: boolean; retryBudgetMs?: number; checkDuplicates?: boolean } = {}) {
  const { silent = false, retryBudgetMs = 0, checkDuplicates = false } = options;

  if (!(await acquireSyncLock())) {
    return NextResponse.json({ ok: true, skipped: true, reason: "outra sincronização já em andamento" });
  }

  try {
    return await runSyncLocked(silent, retryBudgetMs, checkDuplicates);
  } finally {
    await releaseSyncLock();
  }
}

async function runSyncLocked(silent: boolean, retryBudgetMs: number, checkDuplicates: boolean) {
  const start = Date.now();
  let lastMessage = "";
  let attempt = 0;

  do {
    attempt++;
    try {
      const result = await doSync();
      const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      if (!silent) {
        const resumo = await buildResumoMessage(result.desde, result.ate).catch(() => "");
        await sendTelegramMessage(`✅ Dashboard TVB atualizado (${agora})\n${resumo}`);
      }
      // Auditoria de vendedor corrigido — pedido do Rodrigo em 2026-09-01: "o ideal é sempre fazer
      // uma auditoria nos dados". Manda MESMO em sync silenciosa (meio-dia/meia-noite), só pro
      // admin — não é o resumo de rotina, é um alerta de dado que mudou (a loja corrigiu o
      // vendedor de uma venda já sincronizada) e merece atenção mesmo fora do horário de sync
      // "com aviso".
      if (result.vendedorCorrigido.length > 0) {
        const linhas = result.vendedorCorrigido
          .map((c) => {
            const data = c.saleDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
            return `• ${c.clienteNome ?? "—"} — ${c.produto} (${data}): ${c.vendedorAntigo ?? "—"} → ${c.vendedorNovo ?? "—"}`;
          })
          .join("\n");
        await sendTelegramMessage(
          `🔄 Vendedor corrigido em ${result.vendedorCorrigido.length} venda(s) já sincronizada(s):\n${linhas}`,
          { adminOnly: true }
        );
      }

      // Checagens periódicas (só na sync das 8h — ver checkDuplicates em /api/sync/route.ts —
      // pra não rodar 3x/dia à toa nem espalhar a lógica de "que dia é hoje" por vários lugares).
      if (checkDuplicates) {
        const alertaDuplicata = await checkForDuplicateSales().catch(() => null);
        if (alertaDuplicata) await sendTelegramMessage(alertaDuplicata, { adminOnly: true });

        const diaSemanaBrasilia = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "long" }).format(new Date());
        if (diaSemanaBrasilia === "Monday") { // segunda-feira
          const alertaEstoqueParado = await buildAlertaEstoqueParadoSemanal().catch(() => null);
          if (alertaEstoqueParado) await sendTelegramMessage(alertaEstoqueParado, { adminOnly: true });
        }
      }

      return NextResponse.json({ ok: true, ...result, attempt });
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
      console.error(`[sync] tentativa ${attempt} falhou:`, lastMessage);
      await prisma.syncLog.create({
        data: { source: "STOCK", status: "FAILED", message: lastMessage, finishedAt: new Date() },
      }).catch(() => {});

      const remaining = retryBudgetMs - (Date.now() - start);
      if (remaining <= 5_000) break; // não sobra tempo útil pra outra tentativa completa

      // Se o erro veio com "DataLiberacao" (rate limit do login do DAPIC), espera até lá em vez
      // de um fixo de 15s — achado em 2026-08-31: 15s é bem menor que o cooldown real do DAPIC
      // (até 60s), então a 1ª falha de rate limit virava uma cadeia de falhas repetidas em vez de
      // se recuperar sozinha (ver mesmo comentário em connectors/dapic.ts). Se o tempo que falta
      // no orçamento nem cobre a espera exigida, desiste agora — tentar de novo cedo demais só
      // repete a mesma falha e queima o resto do orçamento à toa.
      const dapicWaitMs = waitMsFromDapicError(lastMessage);
      if (dapicWaitMs !== null && dapicWaitMs > remaining - 2_000) break;
      await new Promise((r) => setTimeout(r, Math.min(dapicWaitMs ?? 15_000, remaining)));
    }
  } while (Date.now() - start < retryBudgetMs);

  await sendTelegramMessage(
    `⚠️ Falha ao atualizar o Dashboard TVB (${attempt}x tentativas): ${lastMessage}`,
    { adminOnly: true }
  );
  return NextResponse.json({ ok: false, error: lastMessage, attempts: attempt }, { status: 502 });
}

// Vercel Cron chama via GET com "Authorization: Bearer <CRON_SECRET>" automático.
export async function handleSyncGet(request: NextRequest, options?: { silent?: boolean; retryBudgetMs?: number; checkDuplicates?: boolean }) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runSync(options);
}

// Disparo manual (ex: pra testar), com o segredo num header próprio.
export async function handleSyncPost(request: NextRequest, options?: { silent?: boolean; retryBudgetMs?: number; checkDuplicates?: boolean }) {
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runSync(options);
}
