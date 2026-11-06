// Central Black Friday (missão 2026-11-05) — agrega dado que já existe em outros módulos
// (core/vendas/cac/compras-inteligencia + connectors/meta-ads) numa visão só, sem reimplementar
// nenhuma regra de negócio que já existe em outro lugar (ver saleWhere/returnWhere em core.ts,
// getCacEcommerce em cac.ts, getClassificacaoPorProduto em compras-inteligencia.ts).
//
// Regra inegociável desta tela (ver prompt da missão): canal nunca é somado escondendo a
// origem — Site(CD)/Leblon/Rio Sul/Barra/Atacado aparecem SEMPRE separados, por Store.code real,
// nunca por displayGroup (que hoje agrupa CD+ATACADO só pra exibição no FilterBar).
import { prisma } from "@/lib/prisma";
import { saleWhere, returnWhere, netByReturns, type DashboardFilters } from "./core";
import { getSalesByGrupoProduto, getReturnsByGrupoProduto } from "./vendas";
import { getInsightsPorConjunto } from "@/lib/connectors/meta-ads";
import { todayBrasiliaStr } from "@/lib/filters";

// ===== Exclusão de Atacado (pedido do Rodrigo, 2026-11-05: "não contabilizar atacado na aba de
// central black friday") =====
//
// Afeta só os números "visão geral/ranking/gráfico" desta tela (getResumoBlackFriday,
// getTopProdutosBlackFriday, getSalesByDay via DashboardFilters) — NUNCA getVendasPorCanal: a
// tabela "Por canal" existe justamente pra mostrar Atacado como linha própria, transparente (ver
// comentário no topo do arquivo, "canal nunca é somado escondendo a origem"). Omitir Atacado ali
// seria escondida a origem, não "não contar"; só quem chama (a página) decide qual filtro passar
// pra qual função — este módulo não muda o comportamento de saleWhere/returnWhere/getVendasPorCanal.

// Função PURA (sem Prisma) — recebe o id já resolvido da loja ATACADO e, só quando necessário
// (filters.storeIds indefinido = "sem restrição, todas as lojas"), a lista de ids de todas as
// lojas pra poder expandir "todas menos Atacado". Testável sem banco.
export function excluirAtacado(
  filters: DashboardFilters,
  atacadoStoreId: string | null,
  todosStoreIds: string[]
): DashboardFilters {
  if (!atacadoStoreId) return filters;
  const storeIdsEfetivos = filters.storeIds ?? todosStoreIds;
  if (!storeIdsEfetivos.includes(atacadoStoreId)) return filters;
  return { ...filters, storeIds: storeIdsEfetivos.filter((id) => id !== atacadoStoreId) };
}

// Resolve o id da loja ATACADO e, se preciso, a lista de todas as lojas — e aplica excluirAtacado.
// Se a loja ATACADO não existir (ambiente sem essa loja cadastrada), devolve filters sem alteração.
export async function getFiltrosSemAtacado(filters: DashboardFilters): Promise<DashboardFilters> {
  const precisaTodasLojas = filters.storeIds === undefined;
  const [atacado, todasLojas] = await Promise.all([
    prisma.store.findFirst({ where: { code: "ATACADO" }, select: { id: true } }),
    precisaTodasLojas ? prisma.store.findMany({ select: { id: true } }) : Promise.resolve([]),
  ]);
  return excluirAtacado(filters, atacado?.id ?? null, todasLojas.map((s) => s.id));
}

// ===== Visão geral =====

export type ResumoBlackFriday = {
  from: Date;
  to: Date;
  faturamento: number; // líquido (já descontada devolução)
  pedidos: number; // nº de dapicVendaId distintos no período
  pecas: number; // unidades líquidas
  ticketMedio: number | null;
  investimentoMidia: number;
  investimentoIndisponivel: boolean;
  // Receita total da empresa / investimento total em mídia — métrica "blended" (não é ROAS por
  // canal: o Meta Ads hoje roda majoritariamente pro site, mas essa função soma TODA a receita,
  // de qualquer loja, no denominador contra TODO o gasto). Exibir sempre junto da ressalva de
  // que não é um ROAS por canal/campanha (esse existe só por conjunto/anúncio, ver connectors).
  roas: number | null;
};

export async function getResumoBlackFriday(filters: DashboardFilters): Promise<ResumoBlackFriday> {
  const where = saleWhere(filters);
  const [salesAgg, pedidosRows, returnsAgg, investimentoResult] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { quantidade: true, valorTotalLiquido: true } }),
    prisma.sale.groupBy({ by: ["storeId", "dapicVendaId"], where }),
    prisma.return.aggregate({ where: returnWhere(filters), _sum: { quantidade: true, valorTotal: true } }),
    getInsightsPorConjunto({ since: todayBrasiliaStr(filters.from), until: todayBrasiliaStr(filters.to) }).then(
      (insights) => {
        let total = 0;
        for (const i of insights.values()) total += i.gasto;
        return { valor: total, indisponivel: false };
      },
      () => ({ valor: 0, indisponivel: true })
    ),
  ]);

  const faturamento = (salesAgg._sum.valorTotalLiquido ?? 0) - (returnsAgg._sum.valorTotal ?? 0);
  const pecas = (salesAgg._sum.quantidade ?? 0) - (returnsAgg._sum.quantidade ?? 0);
  const pedidos = pedidosRows.length;

  return {
    from: filters.from,
    to: filters.to,
    faturamento,
    pedidos,
    pecas,
    ticketMedio: pedidos > 0 ? faturamento / pedidos : null,
    investimentoMidia: investimentoResult.valor,
    investimentoIndisponivel: investimentoResult.indisponivel,
    roas: !investimentoResult.indisponivel && investimentoResult.valor > 0 ? faturamento / investimentoResult.valor : null,
  };
}

// Janela imediatamente anterior, mesma duração em dias — usado pra "comparativo com período
// anterior" (item 1 da missão). Quem chama decide se mostra a comparação ou não (só deve mostrar
// quando os dois períodos tiverem pedido/faturamento real — ver condição na página).
export function periodoAnterior(from: Date, to: Date): { from: Date; to: Date } {
  const duracaoMs = to.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - duracaoMs - 1),
    to: new Date(from.getTime() - 1),
  };
}

// ===== Por canal (Store.code real, nunca displayGroup) =====

export type CanalVendasRow = {
  storeId: string;
  code: string;
  nome: string;
  unitsSold: number;
  revenue: number;
  pedidos: number;
  ticketMedio: number | null;
};

// Lista explícita de canais comerciais reais — também usada como ALLOWLIST de filtro em
// getVendasPorCanal (não só ordem de exibição). Mesmo padrão já usado em
// CODES_LOJAS_VAREJO (distribuicao-estoque.ts): decidir "é canal de venda" por uma allowlist
// própria do recurso, nunca por Store.sellsProducts.
//
// Achado real na missão de refinamento (2026-11-05): getVendasPorCanal usava
// `where: { sellsProducts: true }`, e Store.sellsProducts é calculado em armazenadores.ts por um
// regex de EXCLUSÃO (NAO_VENDE) pensado pra decidir se um armazém tem estoque sellável de verdade
// — ele NÃO garante "é canal de venda". "Uniformes", "Produtos acabados" e "Matérias-primas" são
// estágios de manufatura com sellsProducts=true (de propósito — eles têm estoque sellável real,
// usado em outras telas de estoque/vendas, ver estoque.ts/vendas.ts/core.ts) mas apareciam como
// "canal" na Central Black Friday por engano. Rejeitei a correção alternativa de estreitar o
// regex de sellsProducts: esse flag é usado em 7+ arquivos (estoque.ts, vendas.ts, core.ts,
// páginas de performance) — mudar o regex mudaria comportamento em telas que não têm nada a ver
// com "canal de Black Friday", e já existe teste deliberado (armazenadores.test.ts) documentando
// que esses 3 nomes DEVEM passar por sellsProducts. A allowlist abaixo resolve só o problema real
// (identificação de CANAL), sem efeito colateral em estoque/vendas gerais.
//
// Se um canal comercial legítimo novo abrir (ex: nova loja física), adicionar o Store.code aqui
// manualmente — não existe hoje um jeito confiável de detectar "é canal de venda de verdade" só
// pelos dados do DAPIC (sellsProducts é sobre estoque, não sobre canal).
export const ORDEM_CANAL = ["CD", "Leblon", "Rio Sul", "Barra", "ATACADO"];

function nomeCanal(code: string, nome: string): string {
  if (code === "CD") return "Site (CD)";
  return nome;
}

// Função PURA (sem Prisma) — monta a linha por canal a partir de somas já agregadas por
// storeId. Separada pra ser testável sem banco: ver __tests__/blackFriday.test.ts.
export function montarVendasPorCanal(
  stores: { id: string; code: string; name: string }[],
  salesSum: { storeId: string; units: number; revenue: number }[],
  returnsSum: { storeId: string; units: number; value: number }[],
  pedidosPorStore: Map<string, number>
): CanalVendasRow[] {
  const salesByStore = new Map(salesSum.map((s) => [s.storeId, s]));
  const returnsByStore = new Map(returnsSum.map((r) => [r.storeId, r]));

  const rows: CanalVendasRow[] = stores.map((s) => {
    const sold = salesByStore.get(s.id) ?? { units: 0, revenue: 0 };
    const returned = returnsByStore.get(s.id) ?? { units: 0, value: 0 };
    const unitsSold = sold.units - returned.units;
    const revenue = sold.revenue - returned.value;
    const pedidos = pedidosPorStore.get(s.id) ?? 0;
    return {
      storeId: s.id,
      code: s.code,
      nome: nomeCanal(s.code, s.name),
      unitsSold,
      revenue,
      pedidos,
      ticketMedio: pedidos > 0 ? revenue / pedidos : null,
    };
  });

  return rows.sort((a, b) => {
    const ia = ORDEM_CANAL.indexOf(a.code);
    const ib = ORDEM_CANAL.indexOf(b.code);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.nome.localeCompare(b.nome);
  });
}

export async function getVendasPorCanal(filters: DashboardFilters): Promise<CanalVendasRow[]> {
  const where = saleWhere(filters);
  const [stores, salesRows, returnRows, pedidosRows] = await Promise.all([
    prisma.store.findMany({ where: { code: { in: ORDEM_CANAL } }, select: { id: true, code: true, name: true } }),
    prisma.sale.groupBy({ by: ["storeId"], where, _sum: { quantidade: true, valorTotalLiquido: true } }),
    prisma.return.groupBy({ by: ["storeId"], where: returnWhere(filters), _sum: { quantidade: true, valorTotal: true } }),
    prisma.sale.groupBy({ by: ["storeId", "dapicVendaId"], where }),
  ]);

  const pedidosPorStore = new Map<string, number>();
  for (const p of pedidosRows) {
    pedidosPorStore.set(p.storeId, (pedidosPorStore.get(p.storeId) ?? 0) + 1);
  }

  return montarVendasPorCanal(
    stores,
    salesRows.map((r) => ({ storeId: r.storeId, units: r._sum.quantidade ?? 0, revenue: r._sum.valorTotalLiquido ?? 0 })),
    returnRows.map((r) => ({ storeId: r.storeId, units: r._sum.quantidade ?? 0, value: r._sum.valorTotal ?? 0 })),
    pedidosPorStore
  );
}

// ===== Produtos (reaproveita a inteligência de compras já existente) =====

export type ProdutoBlackFriday = {
  grupo: string;
  produto: string;
  unitsSold: number;
  revenue: number;
  classificacao: "BEST_SELLER" | "DROP" | "SEM_CLASSIFICACAO";
};

// Regra de classificação pedida pelo Rodrigo em 2026-11-05 (substitui a leitura do Mapa de
// Compras/ClassificacaoProduto pra esta tela): classificação vem da Coleção real do DAPIC
// (Sale.colecao) — se a coleção for "Bestseller", o produto é BEST_SELLER; qualquer outra coleção
// é DROP. Valores reais confirmados no banco: "BESTSELLER" (exata, case variável possível em
// produção) e várias coleções sazonais (ex: "Drop1 Inverno.26", "Verão 27") que todas caem em DROP
// por essa regra — "Drop" aqui não depende do texto da coleção conter a palavra "drop", é
// literalmente "não é a coleção Bestseller". SEM_CLASSIFICACAO só quando o produto não tem NENHUMA
// venda com coleção preenchida no período (Sale.colecao é opcional) — nunca inventa Best
// Seller/Drop por volume/receita.
const NOME_COLECAO_BESTSELLER = "BESTSELLER";

function normalizarColecao(colecao: string): string {
  return colecao.trim().toUpperCase();
}

// Função PURA (sem Prisma) — monta o ranking a partir da venda líquida já calculada e das
// coleções distintas vistas por produto no período. Testável sem banco, ver
// __tests__/blackFriday.test.ts.
export function montarProdutosBlackFriday(
  liquido: { grupo: string; key: string; unitsSold: number; revenue: number }[],
  colecoesPorProduto: Map<string, string[]>,
  limit = 20
): ProdutoBlackFriday[] {
  return liquido
    .map((v) => {
      const colecoes = colecoesPorProduto.get(`${v.grupo}::${v.key}`) ?? [];
      const temBestseller = colecoes.some((c) => normalizarColecao(c) === NOME_COLECAO_BESTSELLER);
      const classificacao: ProdutoBlackFriday["classificacao"] =
        colecoes.length === 0 ? "SEM_CLASSIFICACAO" : temBestseller ? "BEST_SELLER" : "DROP";
      return {
        grupo: v.grupo,
        produto: v.key,
        unitsSold: v.unitsSold,
        revenue: v.revenue,
        classificacao,
      } satisfies ProdutoBlackFriday;
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

// Coleções distintas (não-nulas) vistas por grupo::produto, dentro do mesmo filtro/período da
// tela — uma consulta de agregação só, sem carregar linha a linha.
async function getColecoesPorProduto(filters: DashboardFilters): Promise<Map<string, string[]>> {
  const rows = await prisma.sale.groupBy({
    by: ["grupo", "produto", "colecao"],
    where: { ...saleWhere(filters), colecao: { not: null } },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.colecao) continue;
    const key = `${r.grupo}::${r.produto}`;
    const arr = map.get(key) ?? [];
    arr.push(r.colecao);
    map.set(key, arr);
  }
  return map;
}

export async function getTopProdutosBlackFriday(filters: DashboardFilters, limit = 20): Promise<ProdutoBlackFriday[]> {
  const [vendas, devolucoes, colecoesPorProduto] = await Promise.all([
    getSalesByGrupoProduto(filters),
    getReturnsByGrupoProduto(filters),
    getColecoesPorProduto(filters),
  ]);
  const liquido = netByReturns(vendas, devolucoes);

  return montarProdutosBlackFriday(liquido, colecoesPorProduto, limit);
}
