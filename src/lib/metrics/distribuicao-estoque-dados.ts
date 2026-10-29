import { prisma } from "@/lib/prisma";
import { cacheAsync, HEAVY_QUERY_CACHE_MS } from "./core";
import {
  CONFIG_DISTRIBUICAO_PADRAO,
  consolidarResultado,
  iniciarExecucao,
  montarUniverso,
  processarLotes,
  type ConfigDistribuicao,
  type EntradaDistribuicao,
  type FontesDistribuicao,
  type LinhaDevolucao,
  type LinhaMovimento,
  type ResultadoDistribuicao,
} from "./distribuicao-estoque";

// Camada de DADOS da distribuição de estoque: só LÊ o que o sync já gravou (StockSnapshot, Sale,
// Return, Gift, ProductionOrder, ClassificacaoProduto, PriceCatalogCache). Não chama o DAPIC, não
// escreve em tabela nenhuma — nem de estoque, nem de pedido, nem de log. Toda a decisão fica nas
// funções puras de distribuicao-estoque.ts.
//
// Campos reais do DAPIC por trás de cada número (via sync-runner.ts):
// - estoque físico: /armazenadores/produtos → QuantidadeReal (fallback Quantidade), gravado em
//   StockSnapshot.quantidadeDisponivel, 1 linha por armazenador+IdGradeProduto;
// - cor/tamanho/grupo/coleção: Cor/Tamanho/Grupo/Colecao da mesma linha (ou da venda);
// - vendas: /vendaspdv (lojas físicas) e /faturas (Site/Atacado), Tipo="Venda", status ≠ Cancelada;
// - devoluções: Tipo="Devolução" (tabela Return), status ≠ Cancelada;
// - brindes: Tipo="Brinde" (tabela Gift) + "Garrafa…" registrada como Venda só por questão
//   tributária (isGarrafaBrinde em dapic.ts) — nunca contados como venda;
// - duplicidade: Sale/Return/Gift têm chave única (storeId, dapicVendaId, itemIndex) com índice
//   estável (stableItemIndexes) — a mesma venda reprocessada não entra duas vezes.

const DIA_MS = 86_400_000;

type MovRaw = {
  storeId: string;
  cod: string;
  produto: string | null;
  grupo: string | null;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  vendas30: number;
  vendas60: number;
  vendas90: number;
  brindes90: number;
  canceladas90: number;
  ultimaVendaJanela: Date | null;
};

async function carregarFontes(referencia: Date, janelaDias: number): Promise<FontesDistribuicao> {
  const d90 = new Date(referencia.getTime() - janelaDias * DIA_MS);
  const d60 = new Date(referencia.getTime() - 60 * DIA_MS);
  const d30 = new Date(referencia.getTime() - 30 * DIA_MS);

  const [lojas, estoque, movimentos, devolucoes, brindes, ultimasVendas, primeiraVenda, primeiraProducao, lancamentos, catalogos] =
    await Promise.all([
      prisma.store.findMany({ select: { id: true, name: true, sellsProducts: true, displayGroup: true } }),
      prisma.stockSnapshot.findMany({
        select: { storeId: true, cod: true, produto: true, grupo: true, cor: true, tamanho: true, colecao: true, quantidadeDisponivel: true, valorCusto: true },
      }),
      // Uma passada só no Sale da janela (em vez de 1 query por loja/variante) — evita N+1.
      prisma.$queryRaw<MovRaw[]>`
        SELECT "storeId", "cod",
          MAX("produto") AS "produto", MAX("grupo") AS "grupo", MAX("cor") AS "cor",
          MAX("tamanho") AS "tamanho", MAX("colecao") AS "colecao",
          COALESCE(SUM("quantidade") FILTER (WHERE "status" <> 'Cancelada' AND "produto" NOT LIKE 'Garrafa%' AND "saleDate" >= ${d30}), 0)::int AS "vendas30",
          COALESCE(SUM("quantidade") FILTER (WHERE "status" <> 'Cancelada' AND "produto" NOT LIKE 'Garrafa%' AND "saleDate" >= ${d60}), 0)::int AS "vendas60",
          COALESCE(SUM("quantidade") FILTER (WHERE "status" <> 'Cancelada' AND "produto" NOT LIKE 'Garrafa%'), 0)::int AS "vendas90",
          COALESCE(SUM("quantidade") FILTER (WHERE "status" <> 'Cancelada' AND "produto" LIKE 'Garrafa%'), 0)::int AS "brindes90",
          COALESCE(SUM("quantidade") FILTER (WHERE "status" = 'Cancelada'), 0)::int AS "canceladas90",
          MAX("saleDate") FILTER (WHERE "status" <> 'Cancelada') AS "ultimaVendaJanela"
        FROM "Sale"
        WHERE "saleDate" >= ${d90} AND "saleDate" <= ${referencia}
        GROUP BY "storeId", "cod"
      `,
      prisma.$queryRaw<LinhaDevolucao[]>`
        SELECT "storeId", "cod",
          COALESCE(SUM("quantidade") FILTER (WHERE "returnDate" >= ${d30}), 0)::int AS "devolucoes30",
          COALESCE(SUM("quantidade") FILTER (WHERE "returnDate" >= ${d60}), 0)::int AS "devolucoes60",
          COALESCE(SUM("quantidade"), 0)::int AS "devolucoes90"
        FROM "Return"
        WHERE "status" <> 'Cancelada' AND "returnDate" >= ${d90} AND "returnDate" <= ${referencia}
        GROUP BY "storeId", "cod"
      `,
      prisma.gift.groupBy({
        by: ["storeId", "cod"],
        where: { giftDate: { gte: d90, lte: referencia } },
        _sum: { quantidade: true },
      }),
      // Última venda de todo o histórico por loja+variante — só pra dizer há quanto tempo uma
      // loja zerada parou de vender (sinal de ruptura), nunca pra extrapolar demanda.
      prisma.sale.groupBy({
        by: ["storeId", "cod"],
        where: { status: { not: "Cancelada" } },
        _max: { saleDate: true },
      }),
      prisma.sale.groupBy({ by: ["cod"], where: { status: { not: "Cancelada" } }, _min: { saleDate: true } }),
      prisma.productionOrder.groupBy({ by: ["cod"], where: { dataFinalizacaoProducao: { not: null } }, _min: { dataFinalizacaoProducao: true } }),
      prisma.classificacaoProduto.findMany({ where: { dataLancamento: { not: null } }, select: { cod: true, dataLancamento: true } }),
      prisma.priceCatalogCache.findMany({ select: { data: true } }),
    ]);

  const primeira = new Map<string, Date>();
  function menor(cod: string, d: Date | null | undefined) {
    if (!d) return;
    const atual = primeira.get(cod);
    if (!atual || d < atual) primeira.set(cod, d);
  }
  for (const r of primeiraVenda) menor(r.cod, r._min.saleDate);
  for (const r of primeiraProducao) menor(r.cod, r._min.dataFinalizacaoProducao);
  for (const r of lancamentos) menor(r.cod, r.dataLancamento);

  const codsCatalogo = new Set<string>();
  for (const c of catalogos) {
    if (c.data && typeof c.data === "object" && !Array.isArray(c.data)) {
      for (const cod of Object.keys(c.data as Record<string, unknown>)) codsCatalogo.add(cod);
    }
  }

  return {
    lojas,
    estoque: estoque.map((e) => ({
      storeId: e.storeId,
      cod: e.cod,
      produto: e.produto,
      grupo: e.grupo,
      cor: e.cor,
      tamanho: e.tamanho,
      colecao: e.colecao,
      quantidade: e.quantidadeDisponivel,
      quantidadeReservada: null,
      valorCusto: e.valorCusto,
    })),
    movimentos: movimentos.map(
      (m): LinhaMovimento => ({
        ...m,
        vendas30: Number(m.vendas30),
        vendas60: Number(m.vendas60),
        vendas90: Number(m.vendas90),
        brindes90: Number(m.brindes90),
        canceladas90: Number(m.canceladas90),
      })
    ),
    devolucoes: devolucoes.map((d) => ({
      ...d,
      devolucoes30: Number(d.devolucoes30),
      devolucoes60: Number(d.devolucoes60),
      devolucoes90: Number(d.devolucoes90),
    })),
    brindes: brindes.map((b) => ({ storeId: b.storeId, cod: b.cod, brindes90: b._sum.quantidade ?? 0 })),
    ultimasVendas: ultimasVendas
      .filter((u) => u._max.saleDate != null)
      .map((u) => ({ storeId: u.storeId, cod: u.cod, ultimaVenda: u._max.saleDate as Date })),
    primeirasAparicoes: [...primeira.entries()].map(([cod, data]) => ({ cod, data })),
    codsCatalogoPrecos: [...codsCatalogo],
  };
}

// Versão dos dados = horário do último sync bem-sucedido de estoque e de vendas. É o que
// identifica "qual foto do banco" uma execução analisou, e a chave do cache abaixo.
export async function getVersaoDadosDistribuicao(): Promise<{ versao: string; ultimoSyncEstoque: Date | null; ultimoSyncVendas: Date | null }> {
  const [estoque, vendas] = await Promise.all([
    prisma.syncLog.findFirst({ where: { source: "STOCK", status: "SUCCESS" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    prisma.syncLog.findFirst({ where: { source: "SALES", status: "SUCCESS" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
  ]);
  const e = estoque?.finishedAt ?? null;
  const v = vendas?.finishedAt ?? null;
  return { versao: `estoque:${e?.toISOString() ?? "nunca"}|vendas:${v?.toISOString() ?? "nunca"}`, ultimoSyncEstoque: e, ultimoSyncVendas: v };
}

export async function montarEntradaDistribuicao(
  referencia: Date = new Date(),
  config: ConfigDistribuicao = CONFIG_DISTRIBUICAO_PADRAO
): Promise<EntradaDistribuicao & { ultimoSyncEstoque: Date | null; ultimoSyncVendas: Date | null; linhasEstoque: number }> {
  const [{ versao, ultimoSyncEstoque, ultimoSyncVendas }, fontes] = await Promise.all([
    getVersaoDadosDistribuicao(),
    carregarFontes(referencia, config.janelaDemandaDias),
  ]);
  const { variantes, locais } = montarUniverso(fontes);
  const limitacoesGlobais = [
    "Estoque reservado/comprometido (QuantidadeComprometida do DAPIC) não é gravado pelo sync atual — estoque disponível = físico registrado (QuantidadeReal).",
    "Não existe histórico diário de estoque (StockSnapshot guarda só a foto atual): não dá pra contar os dias em que cada loja teve a peça disponível. Rupturas só reduzem a confiança; venda perdida nunca é estimada como venda observada.",
    "Universo = SKUs com linha de estoque em qualquer armazenador + SKUs vendidos/devolvidos/brindados na janela + SKUs do catálogo de preços do DAPIC. SKU que nunca teve estoque, venda nem preço cadastrado não existe em nenhuma fonte sincronizada.",
    "Idade da variante = 1ª venda, 1ª produção finalizada ou data de lançamento cadastrada (a mais antiga). Ordens de produção só existem desde 2025-08.",
    "Brindes (Tipo=Brinde e garrafas registradas como venda) e cancelamentos ficam fora da venda líquida; devoluções são subtraídas na loja e janela em que ocorreram.",
  ];
  return {
    variantes,
    locais,
    referencia,
    versaoDados: versao,
    limitacoesGlobais,
    ultimoSyncEstoque,
    ultimoSyncVendas,
    linhasEstoque: fontes.estoque.length,
  };
}

export type AnaliseDistribuicaoCompleta = ResultadoDistribuicao & {
  ultimoSyncEstoque: string | null;
  ultimoSyncVendas: string | null;
  linhasEstoque: number;
};

// Executa o catálogo inteiro em lotes (todos, até o fim) sobre os dados já sincronizados. Cache
// por versão dos dados: enquanto não roda sync novo, a tela de Distribuição e o Mapa de Compras
// leem o MESMO resultado em vez de recalcular por tela.
export async function getAnaliseDistribuicaoEstoque(): Promise<AnaliseDistribuicaoCompleta> {
  const { versao } = await getVersaoDadosDistribuicao();
  return cacheAsync(`distribuicao-estoque:${versao}`, HEAVY_QUERY_CACHE_MS, async () => {
    const entrada = await montarEntradaDistribuicao();
    let estado = iniciarExecucao(entrada);
    // Lote a lote até o fim: nunca devolve uma execução parcial como se fosse completa.
    while (estado.status === "EM_PROCESSAMENTO") {
      estado = processarLotes(entrada, estado, CONFIG_DISTRIBUICAO_PADRAO, 1);
    }
    const resultado = consolidarResultado(entrada, estado, CONFIG_DISTRIBUICAO_PADRAO);
    return {
      ...resultado,
      ultimoSyncEstoque: entrada.ultimoSyncEstoque?.toISOString() ?? null,
      ultimoSyncVendas: entrada.ultimoSyncVendas?.toISOString() ?? null,
      linhasEstoque: entrada.linhasEstoque,
    };
  });
}
