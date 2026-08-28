import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { createDapicClients, stripReferenciaPrefix, parseDapicDateTime, type DapicClient } from "@/lib/connectors/dapic";
// (import type { Prisma } removido abaixo — já importado acima como valor+tipo)
import { displayGroupFor, sellsProducts } from "@/lib/connectors/armazenadores";
import { upsertStockSnapshots, type StockSnapshotRow } from "@/lib/connectors/upsert-stock";
import { upsertProductionOrders, type ProductionOrderRow } from "@/lib/connectors/upsert-production-order";
import { fetchPriceCatalogCached, inferTabelaPreco, type PriceCatalog } from "@/lib/connectors/tabela-preco";
import { sendTelegramMessage } from "@/lib/telegram";
import { getTopParaIncentivar, getTopVendidosPorLoja } from "@/lib/metrics";
import { brasiliaDayStart, brasiliaDayEnd, todayBrasiliaStr } from "@/lib/filters";

// Lógica compartilhada pelas duas rotas de sync (/api/sync e /api/sync-evening) — precisam ser
// arquivos de rota separados (paths diferentes) porque o plano Hobby da Vercel só permite um
// cron job rodando 1x/dia CADA, e dois crons apontando pro mesmo path deixavam o registro deles
// num estado ambíguo (a sync da manhã simplesmente parou de disparar).

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function syncArmazenadores(client: DapicClient) {
  const armazenadores = await client.fetchArmazenadores();
  const storeByDapicId = new Map<number, string>();
  let primaryStoreId: string | null = null;

  for (const a of armazenadores) {
    const existing = await prisma.store.findFirst({
      where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] },
    });
    const sells = sellsProducts(a.Descricao);
    const group = displayGroupFor(a.Descricao);
    const store = existing
      ? await prisma.store.update({
          where: { id: existing.id },
          data: { dapicArmazenadorId: a.Id, displayGroup: group },
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
  }

  return { storeByDapicId, primaryStoreId };
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
async function syncVendas(client: DapicClient, storeId: string | null, dias: number, priceCatalog: PriceCatalog) {
  if (!storeId) return { vendas: 0, devolucoes: 0, brindes: 0 };
  const contaVendaDoPdv = client.label !== "cd-atacado";
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - dias);
  const vendasPdv = await client.fetchVendasPdv(toDateStr(inicio), toDateStr(hoje));

  const saleData: Prisma.SaleCreateManyInput[] = [];
  const returnData: Prisma.ReturnCreateManyInput[] = [];
  const giftData: Prisma.GiftCreateManyInput[] = [];

  for (const venda of vendasPdv) {
    if (venda.Status !== "Fechada" || !venda.DataFechamento) continue;
    const saleDate = parseDapicDateTime(venda.DataFechamento);

    venda.Produtos.forEach((item) => {
      const cod = item.IdGradeProduto != null ? String(item.IdGradeProduto) : venda.Codigo;
      if (item.Tipo === "Venda" && contaVendaDoPdv) {
        saleData.push({
          storeId,
          dapicVendaId: venda.Id,
          // Id da linha (estável), não posição no array (ver comentário no tipo
          // DapicVendaPdvProduto) — achado real de duplicata em 2026-08-12.
          itemIndex: item.Id,
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
          valorTotalLiquido: item.ValorLiquido,
          tabelaPreco: inferTabelaPreco(cod, item.ValorUnitario, priceCatalog),
          saleDate,
        });
      } else if (item.Tipo === "Devolução") {
        returnData.push({
          storeId,
          dapicVendaId: venda.Id,
          itemIndex: item.Id,
          cod,
          produto: item.Produto,
          grupo: item.Grupo ?? "(sem grupo)",
          cor: item.Cor ?? null,
          tamanho: item.Tamanho ?? null,
          marca: item.Marca ?? null,
          tabelaPreco: inferTabelaPreco(cod, item.ValorUnitario, priceCatalog),
          quantidade: item.Quantidade,
          valorTotal: item.ValorLiquido,
          returnDate: saleDate,
        });
      } else if (item.Tipo === "Brinde") {
        giftData.push({
          storeId,
          dapicVendaId: venda.Id,
          itemIndex: item.Id,
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

  // skipDuplicates: idempotente em cima de (storeId, dapicVendaId, itemIndex) — o cron roda 2x/dia
  // olhando sempre "últimos N dias", então as janelas se sobrepõem e sem isso duplicava tudo.
  if (saleData.length) await prisma.sale.createMany({ data: saleData, skipDuplicates: true });
  if (returnData.length) await prisma.return.createMany({ data: returnData, skipDuplicates: true });
  if (giftData.length) await prisma.gift.createMany({ data: giftData, skipDuplicates: true });
  return { vendas: saleData.length, devolucoes: returnData.length, brindes: giftData.length };
}

// Venda de verdade do canal Site+Atacado (só cd-atacado tem acesso a /faturas). Mesma chave de
// idempotência (storeId, dapicVendaId=Id da fatura, itemIndex) — nunca colide com vendaspdv
// porque esse token não grava mais Sale via vendaspdv (ver syncVendas).
async function syncFaturas(client: DapicClient, storeId: string | null, dias: number, priceCatalog: PriceCatalog) {
  if (!storeId || client.label !== "cd-atacado") return { vendas: 0, brindes: 0 };
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

    produtos.forEach((item) => {
      if (item.Tipo === "Brinde") {
        giftData.push({
          storeId,
          dapicVendaId: fatura.Id,
          itemIndex: item.Id,
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
      saleData.push({
        storeId,
        dapicVendaId: fatura.Id,
        itemIndex: item.Id,
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
        valorTotalLiquido: item.Valores.ValorTotal,
        tabelaPreco: inferTabelaPreco(String(item.IdGradeProduto), item.Valores.ValorUnitario, priceCatalog),
        saleDate,
      });
    });
  }
  if (giftData.length) await prisma.gift.createMany({ data: giftData, skipDuplicates: true });

  if (saleData.length) await prisma.sale.createMany({ data: saleData, skipDuplicates: true });
  return { vendas: saleData.length, brindes: giftData.length };
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
      (c) => Prisma.sql`(${randomUUID()}, ${c.Id}, ${c.NomeRazaoSocial}, ${c.Telefone ?? null}, ${c.Celular ?? null}, ${c.Email ?? null}, ${c.DataAniversario ? new Date(c.DataAniversario) : null}, ${c.CpfCnpj ?? null})`
    );
    await prisma.$executeRaw`
      INSERT INTO "ClienteCadastro" ("id", "dapicId", "nome", "telefone", "celular", "email", "dataNascimento", "cpfCnpj")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("dapicId") DO UPDATE SET
        "nome"           = EXCLUDED."nome",
        "telefone"       = EXCLUDED."telefone",
        "celular"        = EXCLUDED."celular",
        "email"          = EXCLUDED."email",
        "dataNascimento" = EXCLUDED."dataNascimento",
        "cpfCnpj"        = EXCLUDED."cpfCnpj"
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
  const BATCH = 500;
  let count = 0;
  for (let i = 0; i < parcelas.length; i += BATCH) {
    const batch = parcelas.slice(i, i + BATCH);
    await prisma.parcela.createMany({
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
    count += batch.length;
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
    const { storeByDapicId, primaryStoreId } = await syncArmazenadores(client);
    const [estoque, priceCatalog] = await Promise.all([
      syncEstoque(client, storeByDapicId),
      fetchPriceCatalogCached(prisma, client),
    ]);
    // Janela de 1 dia (24h) — cobre com folga o intervalo entre os 2 syncs diários (12h) e
    // reduz o volume processado (menos chamadas de /faturas, que é 1 por fatura pro
    // Site+Atacado). Se um sync falhar, o self-heal-sync.ts (dispara sozinho se o último
    // SyncLog tiver mais de 5h) cobre o risco de perder dado mais velho que essa janela.
    const vendas = await syncVendas(client, primaryStoreId, 1, priceCatalog);
    const faturas = await syncFaturas(client, primaryStoreId, 1, priceCatalog);
    return {
      estoque,
      vendas: vendas.vendas + faturas.vendas,
      devolucoes: vendas.devolucoes,
      brindes: vendas.brindes + faturas.brindes,
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

  const [results, totalOrdensProducao, totalClientes] = await Promise.all([
    (async () => {
      const outrosResultados = await Promise.all(outrasLojas.map(syncOneClient));
      const cdResultado = cdAtacadoClient ? [await syncOneClient(cdAtacadoClient)] : [];
      return [...outrosResultados, ...cdResultado];
    })(),
    // Não fatal: se o token da matriz ainda não estiver configurado (ex: só em dev, não em
    // produção), syncOrdensProducao devolve 0 sem quebrar o resto da sync.
    syncOrdensProducao(matrizClient).catch((e) => { console.error("[syncOrdensProducao] falhou:", e?.message ?? e); return 0; }),
    // Clientes — 1 token basta, não é fatal se falhar
    (cdAtacadoClient ? syncClientes(cdAtacadoClient) : Promise.resolve(0)).catch(() => 0),
    // Parcelas em aberto (inadimplência) — não é fatal se falhar
    (cdAtacadoClient ? syncParcelas(cdAtacadoClient) : Promise.resolve(0)).catch((e) => { console.error("[syncParcelas] falhou:", e?.message ?? e); return 0; }),
  ]);

  const totalEstoque = results.reduce((a, r) => a + r.estoque, 0);
  const totalVendas = results.reduce((a, r) => a + r.vendas, 0);
  const totalDevolucoes = results.reduce((a, r) => a + r.devolucoes, 0);
  const totalBrindes = results.reduce((a, r) => a + r.brindes, 0);

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
export async function runSync(options: { silent?: boolean; retryBudgetMs?: number } = {}) {
  const { silent = false, retryBudgetMs = 0 } = options;
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
      return NextResponse.json({ ok: true, ...result, attempt });
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
      console.error(`[sync] tentativa ${attempt} falhou:`, lastMessage);
      await prisma.syncLog.create({
        data: { source: "STOCK", status: "FAILED", message: lastMessage, finishedAt: new Date() },
      }).catch(() => {});

      const remaining = retryBudgetMs - (Date.now() - start);
      if (remaining <= 5_000) break; // não sobra tempo útil pra outra tentativa completa
      await new Promise((r) => setTimeout(r, Math.min(15_000, remaining)));
    }
  } while (Date.now() - start < retryBudgetMs);

  await sendTelegramMessage(
    `⚠️ Falha ao atualizar o Dashboard TVB (${attempt}x tentativas): ${lastMessage}`,
    { adminOnly: true }
  );
  return NextResponse.json({ ok: false, error: lastMessage, attempts: attempt }, { status: 502 });
}

// Vercel Cron chama via GET com "Authorization: Bearer <CRON_SECRET>" automático.
export async function handleSyncGet(request: NextRequest, options?: { silent?: boolean; retryBudgetMs?: number }) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runSync(options);
}

// Disparo manual (ex: pra testar), com o segredo num header próprio.
export async function handleSyncPost(request: NextRequest, options?: { silent?: boolean; retryBudgetMs?: number }) {
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runSync(options);
}
