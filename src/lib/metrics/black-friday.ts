// Central Black Friday (missão 2026-11-05) — agrega dado que já existe em outros módulos
// (core/vendas/cac/compras-inteligencia + connectors/meta-ads) numa visão só, sem reimplementar
// nenhuma regra de negócio que já existe em outro lugar (ver saleWhere/returnWhere em core.ts,
// getCacEcommerce em cac.ts, getClassificacaoPorProduto em compras-inteligencia.ts).
//
// Regra original da missão (canal nunca somado escondendo a origem: Site(CD)/Leblon/Rio
// Sul/Barra/Atacado SEMPRE separados, por Store.code real, nunca por displayGroup) foi
// REVOGADA em 2026-11-06 especificamente pro Atacado: Rodrigo pediu "tire qualquer venda do
// atacado dessa aba" — não só dos totais, também da tabela "Por canal". Atacado não aparece mais
// em NENHUM lugar da Central Black Friday (ver getFiltrosSemAtacado abaixo, aplicado a todas as
// funções desta tela sem exceção agora). As outras lojas (CD/Leblon/Rio Sul/Barra) continuam
// sempre separadas entre si, só o Atacado saiu de cena por completo.
import { prisma } from "@/lib/prisma";
import { saleWhere, returnWhere, netByReturns, type DashboardFilters } from "./core";
import { getSalesByGrupoProduto, getReturnsByGrupoProduto, getSalesByDay } from "./vendas";
import { getEcommerceStoreId } from "./cac";
import { getInsightsPorConjunto } from "@/lib/connectors/meta-ads";
import { todayBrasiliaStr } from "@/lib/filters";

// ===== Exclusão de Atacado (pedido do Rodrigo, 2026-11-05, ampliado em 2026-11-06 pra cobrir
// TUDO nesta tela, inclusive a tabela "Por canal" — ver comentário no topo do arquivo) =====
//
// A página (black-friday/page.tsx) passa filtrosSemAtacado pra TODAS as funções desta tela sem
// exceção, incluindo getVendasPorCanal — este módulo não muda o comportamento de
// saleWhere/returnWhere/getVendasPorCanal em si, só quem chama decide qual filtro passar.

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
  // Receita líquida SÓ do e-commerce (Store.code="CD", mesmo Store resolvido por
  // getEcommerceStoreId em cac.ts) sobre o investimento total em mídia do Meta Ads. Corrigido em
  // 2026-11-06 (pedido do Rodrigo): antes somava a receita de TODAS as lojas (menos Atacado) no
  // numerador — "blended", não um ROAS de canal de verdade, já que o Meta Ads hoje roda
  // majoritariamente pro site. Ressalva que ainda vale: o denominador (investimentoMidia) é a
  // soma de TODOS os anúncios da conta — não existe hoje nenhuma forma de isolar só o gasto que
  // de fato aponta pro site (assume-se que é praticamente todo ele). Vira null quando: faltar
  // investimento (ver investimentoIndisponivel), a loja CD não existir no ambiente, ou a permissão
  // do usuário (allowedStoreIds) já excluir CD inteiramente — nunca mostra um número calculado com
  // dado que o usuário não tem acesso.
  roas: number | null;
};

// Receita líquida (venda - devolução, mesma convenção do resto deste arquivo) restrita SÓ à loja
// de e-commerce (Store.code="CD") — numerador do ROAS corrigido. Reaproveita getEcommerceStoreId
// (cac.ts) em vez de resolver o Store de novo aqui.
//
// Respeita a restrição de loja já embutida em `filters.storeIds` (vem de getStoreRestriction,
// ver permissions.ts, já aplicada antes de chegar aqui): se o usuário não pode ver a loja CD,
// devolve null — nunca ignora a permissão pra calcular um número que ele não deveria ver, nem
// finge "0" (que pareceria "sem venda" em vez de "indisponível pra você").
async function getFaturamentoEcommerce(
  filters: DashboardFilters,
  cdStoreId: string | null
): Promise<number | null> {
  if (!cdStoreId) return null;
  if (filters.storeIds !== undefined && !filters.storeIds.includes(cdStoreId)) return null;

  const filtrosCd: DashboardFilters = { ...filters, storeIds: [cdStoreId] };
  const [salesAgg, returnsAgg] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere(filtrosCd), _sum: { valorTotalLiquido: true } }),
    prisma.return.aggregate({ where: returnWhere(filtrosCd), _sum: { valorTotal: true } }),
  ]);
  return (salesAgg._sum.valorTotalLiquido ?? 0) - (returnsAgg._sum.valorTotal ?? 0);
}

export async function getResumoBlackFriday(filters: DashboardFilters): Promise<ResumoBlackFriday> {
  const where = saleWhere(filters);
  const [salesAgg, pedidosRows, returnsAgg, investimentoResult, cdStoreId] = await Promise.all([
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
    getEcommerceStoreId(),
  ]);
  const faturamentoEcommerce = await getFaturamentoEcommerce(filters, cdStoreId);

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
    roas:
      !investimentoResult.indisponivel && investimentoResult.valor > 0 && faturamentoEcommerce != null
        ? faturamentoEcommerce / investimentoResult.valor
        : null,
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

// ===== Por faixa de desconto real (PrecoBlackFriday) =====
//
// Pedido do Rodrigo (2026-11-06): "como estão as vendas dos produtos com tal % de desconto" —
// cruza a venda líquida do período com o desconto REAL aplicado a cada produto na Black Friday
// (planilha "Preços Black Friday.xlsx", importada em PrecoBlackFriday por
// scripts/black-friday/importar-precos.ts). Chave de junção é grupo+produto — o mesmo grain já
// usado em getSalesByGrupoProduto/getTopProdutosBlackFriday, não a Coleção (que é descritiva na
// planilha, não uma chave).
//
// Esta função recebe `filters` já SEM Atacado quando é isso que a tela quer — a exclusão de
// Atacado não é decidida aqui, é decidida por quem chama (mesmo padrão de getResumoBlackFriday/
// getTopProdutosBlackFriday: a página passa `filtrosSemAtacado`, resultado de
// getFiltrosSemAtacado(filters), não `filters` original).
//
// Convenção corrigida a pedido do Rodrigo (2026-11-06): "se não tem desconto cadastrado = 0%".
// Isso substitui o design anterior (PR #54) de um bucket `desconto: null` ("Sem desconto
// cadastrado") separado — produto vendido no período sem linha correspondente em PrecoBlackFriday
// agora é tratado como desconto=0 e cai DENTRO do mesmo bucket 0% real (junto com produtos que já
// têm desconto=0 explícito na planilha), não numa linha própria. `desconto` nunca é null por essa
// via; o bucket 0 é sempre semeado (mesmo que a planilha não tenha nenhuma linha com desconto=0
// cadastrado), pra garantir que essas vendas sempre tenham onde cair.
export type FaixaDescontoProduto = {
  grupo: string;
  produto: string;
  unitsSold: number;
  revenue: number;
};

export type FaixaDescontoRow = {
  desconto: number;
  label: string;
  unitsSold: number;
  revenue: number;
  produtosDistintos: number;
  // Preço médio líquido por peça vendida nessa faixa (revenue/unitsSold) — NÃO é "ticket médio
  // por pedido" (esse exigiria agrupar por dapicVendaId, que não existe neste grain
  // grupo+produto; ver ticketMedio em ResumoBlackFriday/CanalVendasRow pra esse outro sentido).
  precoMedioLiquido: number | null;
  // Produtos que compõem esta faixa, ordenados por receita líquida decrescente — alimenta o
  // dropdown "melhores produtos de cada %" (pedido do Rodrigo, 2026-11-06) sem round-trip
  // adicional ao banco: já é a mesma venda líquida usada pra montar a linha agregada acima.
  produtos: FaixaDescontoProduto[];
};

// Função PURA (sem Prisma) — recebe a venda líquida já calculada (mesma netByReturns usada em
// getTopProdutosBlackFriday) e o mapa grupo::produto -> desconto real, e monta uma linha por
// faixa (agregada) + a lista de produtos que a compõem. `faixasReais` garante que toda faixa
// cadastrada na planilha apareça mesmo com zero venda no período (nunca omitida por falta de
// venda); o bucket 0 é sempre garantido independentemente de `faixasReais` conter 0 ou não —
// testável sem banco, ver __tests__/blackFriday.test.ts.
export function montarVendasPorFaixaDesconto(
  liquido: { grupo: string; key: string; unitsSold: number; revenue: number }[],
  precosPorProduto: Map<string, number>,
  faixasReais: number[]
): FaixaDescontoRow[] {
  type Acc = { unitsSold: number; revenue: number; produtos: FaixaDescontoProduto[] };
  const buckets = new Map<number, Acc>();

  function getBucket(chave: number): Acc {
    let b = buckets.get(chave);
    if (!b) {
      b = { unitsSold: 0, revenue: 0, produtos: [] };
      buckets.set(chave, b);
    }
    return b;
  }

  for (const f of faixasReais) getBucket(f);
  getBucket(0); // garante o bucket 0% mesmo que a planilha não tenha nenhuma linha com desconto=0

  for (const v of liquido) {
    const chaveProduto = `${v.grupo}::${v.key}`;
    const desconto = precosPorProduto.has(chaveProduto) ? precosPorProduto.get(chaveProduto)! : 0;
    const b = getBucket(desconto);
    b.unitsSold += v.unitsSold;
    b.revenue += v.revenue;
    b.produtos.push({ grupo: v.grupo, produto: v.key, unitsSold: v.unitsSold, revenue: v.revenue });
  }

  const rows: FaixaDescontoRow[] = [...buckets.entries()].map(([desconto, b]) => ({
    desconto,
    label: `${Math.round(desconto * 100)}%`,
    unitsSold: b.unitsSold,
    revenue: b.revenue,
    produtosDistintos: b.produtos.length,
    precoMedioLiquido: b.unitsSold > 0 ? b.revenue / b.unitsSold : null,
    produtos: [...b.produtos].sort((a, c) => c.revenue - a.revenue),
  }));

  return rows.sort((a, b) => a.desconto - b.desconto);
}

// Faixas de desconto reais distintas, cadastradas na planilha (PrecoBlackFriday) — não um range
// fixo no código, pra acompanhar automaticamente se o Rodrigo adicionar/remover faixas numa
// atualização futura da planilha.
async function getFaixasDescontoReais(): Promise<number[]> {
  const rows = await prisma.precoBlackFriday.findMany({
    select: { desconto: true },
    distinct: ["desconto"],
    orderBy: { desconto: "asc" },
  });
  return rows.map((r) => r.desconto);
}

async function getPrecosPorProduto(): Promise<Map<string, number>> {
  const rows = await prisma.precoBlackFriday.findMany({ select: { grupo: true, produto: true, desconto: true } });
  const map = new Map<string, number>();
  for (const r of rows) map.set(`${r.grupo}::${r.produto}`, r.desconto);
  return map;
}

export async function getVendasPorFaixaDesconto(filters: DashboardFilters): Promise<FaixaDescontoRow[]> {
  const [vendas, devolucoes, faixasReais, precosPorProduto] = await Promise.all([
    getSalesByGrupoProduto(filters),
    getReturnsByGrupoProduto(filters),
    getFaixasDescontoReais(),
    getPrecosPorProduto(),
  ]);
  const liquido = netByReturns(vendas, devolucoes);

  return montarVendasPorFaixaDesconto(liquido, precosPorProduto, faixasReais);
}

// ===== Meta diária (MetaDiariaBlackFriday) =====
//
// Pedido do Rodrigo (2026-11-06, "só o periodo da black"): comparar, dia a dia, a meta de
// faturamento 2026 (planilha "Plano BF 2026.xlsx", importada por
// scripts/black-friday/importar-meta-diaria.ts em MetaDiariaBlackFriday) com o faturamento REAL
// do mesmo dia em 2026 e com o real de 2025 (mesma planilha). Escopo deliberadamente restrito ao
// período que a planilha cobre (2026-11-01 a 2026-11-30 no import confirmado em 2026-11-06, ver
// comentário do model no schema) — não é um sistema de meta anual.
//
// Esta função recebe `filters` já SEM Atacado quando é isso que a tela quer — mesmo padrão de
// getResumoBlackFriday/getVendasPorFaixaDesconto: a exclusão de Atacado é decidida por quem chama
// (página passa filtrosSemAtacado), não aqui. A meta é sobre desempenho de varejo/e-commerce da
// campanha, não sobre o Atacado.
//
// A janela comparada é sempre a janela CADASTRADA em MetaDiariaBlackFriday (min/max de `data`),
// nunca o período escolhido no seletor de data da página — este painel é sobre a campanha inteira,
// independente do filtro De/Até aplicado no resto da Central Black Friday.

export type ComparativoDiaBlackFriday = {
  data: string; // "YYYY-MM-DD", dia de Brasília
  metaReceita2026: number;
  receitaReal2026: number;
  // null só quando metaReceita2026 é 0 (nunca divide por zero) — não deveria acontecer na
  // prática (toda linha da planilha tem meta > 0), mas a função não assume isso.
  atingimentoPct: number | null;
  diferencaReal: number; // receitaReal2026 - metaReceita2026 (positivo = bateu/passou a meta)
  // null = a planilha não tem real 2025 pra este dia — nunca inventa 0 (apareceria como "caiu
  // 100%" quando na verdade é "sem dado"). Ver comentário do campo no model.
  receitaReal2025: number | null;
  crescimentoAnualPct: number | null; // null quando não há receitaReal2025 ou ele é 0
  acao: string | null;
};

export type ComparativoAcumuladoBlackFriday = {
  metaReceita2026: number;
  receitaReal2026: number;
  atingimentoPct: number | null;
  diferencaReal: number;
};

export type ResumoMetaDiariaBlackFriday = {
  dias: ComparativoDiaBlackFriday[];
  acumulado: ComparativoAcumuladoBlackFriday;
  // Linha de `dias` cujo `data` é hoje (Brasília) — null quando hoje cai fora da janela
  // cadastrada na planilha (campanha ainda não começou, ou já terminou). UI usa isso pro bloco
  // "hoje" (faturamento realizado hoje/meta do dia/% atingimento/diferença/real 2025 do
  // dia/crescimento anual), nunca mostrando esse bloco fabricado quando não existe hoje real.
  hoje: ComparativoDiaBlackFriday | null;
};

// Função PURA — procura a linha de `dias` cujo `data` bate com `dataStr` exatamente. Separada de
// montarComparativoMetaDiariaBlackFriday só pra poder testar "hoje" sem depender do relógio real
// (ver __tests__/blackFriday.test.ts).
export function encontrarDiaPorData(dias: ComparativoDiaBlackFriday[], dataStr: string): ComparativoDiaBlackFriday | null {
  return dias.find((d) => d.data === dataStr) ?? null;
}

// Função PURA (sem Prisma, sem relógio real) — monta a comparação dia a dia a partir das metas
// já lidas do banco e da receita líquida real já agregada por dia (mesmo formato devolvido por
// getSalesByDay: um Map "YYYY-MM-DD" -> receita líquida). `hojeStr` é passado por quem chama (a
// versão async resolve com todayBrasiliaStr(new Date())) — nunca lido daqui, pra manter esta
// função testável sem depender do relógio real. Testável, ver __tests__/blackFriday.test.ts.
export function montarComparativoMetaDiariaBlackFriday(
  metas: { data: string; metaReceita2026: number; receitaReal2025: number | null; acao: string | null }[],
  receitaRealPorDia: Map<string, number>,
  hojeStr: string | null = null
): ResumoMetaDiariaBlackFriday {
  const dias: ComparativoDiaBlackFriday[] = metas
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((m) => {
      // Dia sem nenhuma venda registrada ainda (campanha não chegou lá, ou sync atrasado) conta
      // como 0 de receita real — diferente de receitaReal2025 (esse sim fica null quando falta),
      // porque aqui "sem Sale no período" é um fato real sobre o Sale, não um dado ausente da
      // planilha.
      const receitaReal2026 = receitaRealPorDia.get(m.data) ?? 0;
      const atingimentoPct = m.metaReceita2026 !== 0 ? (receitaReal2026 / m.metaReceita2026) * 100 : null;
      const crescimentoAnualPct =
        m.receitaReal2025 != null && m.receitaReal2025 !== 0
          ? ((receitaReal2026 - m.receitaReal2025) / m.receitaReal2025) * 100
          : null;
      return {
        data: m.data,
        metaReceita2026: m.metaReceita2026,
        receitaReal2026,
        atingimentoPct,
        diferencaReal: receitaReal2026 - m.metaReceita2026,
        receitaReal2025: m.receitaReal2025,
        crescimentoAnualPct,
        acao: m.acao,
      } satisfies ComparativoDiaBlackFriday;
    });

  // Acumulado no mês = soma de TODOS os dias cadastrados (a planilha só cadastra dia de
  // campanha real, então "acumulado" aqui já é "acumulado da campanha até onde a planilha
  // cobre" — não existe hoje um corte de "só até hoje", ver comentário da função async abaixo).
  const metaAcumulada = dias.reduce((s, d) => s + d.metaReceita2026, 0);
  const realAcumulado = dias.reduce((s, d) => s + d.receitaReal2026, 0);

  return {
    dias,
    acumulado: {
      metaReceita2026: metaAcumulada,
      receitaReal2026: realAcumulado,
      atingimentoPct: metaAcumulada !== 0 ? (realAcumulado / metaAcumulada) * 100 : null,
      diferencaReal: realAcumulado - metaAcumulada,
    },
    hoje: hojeStr != null ? encontrarDiaPorData(dias, hojeStr) : null,
  };
}

export async function getComparativoMetaDiariaBlackFriday(
  filters: DashboardFilters
): Promise<ResumoMetaDiariaBlackFriday> {
  const metasRows = await prisma.metaDiariaBlackFriday.findMany({ orderBy: { data: "asc" } });
  if (metasRows.length === 0) {
    return {
      dias: [],
      acumulado: { metaReceita2026: 0, receitaReal2026: 0, atingimentoPct: null, diferencaReal: 0 },
      hoje: null,
    };
  }

  const primeiraData = metasRows[0].data;
  const ultimaData = metasRows[metasRows.length - 1].data;
  // getSalesByDay (vendas.ts) já devolve líquido (venda - devolução) por dia de Brasília — a
  // mesma função usada no gráfico "Receita líquida por dia" da Visão Geral, reaproveitada aqui em
  // vez de reimplementar a agregação. Sobrescreve from/to de `filters` pra cobrir a janela
  // CADASTRADA na planilha de meta (ver comentário no topo da seção), não o período escolhido no
  // seletor De/Até da página.
  const filtrosJanelaCampanha: DashboardFilters = {
    ...filters,
    from: primeiraData,
    to: new Date(ultimaData.getTime() + 86399999), // fim do último dia cadastrado (23:59:59.999)
  };
  const salesByDay = await getSalesByDay(filtrosJanelaCampanha);
  const receitaRealPorDia = new Map(salesByDay.map((s) => [s.day, s.revenue]));

  const metas = metasRows.map((m) => ({
    data: m.data.toISOString().slice(0, 10),
    metaReceita2026: m.metaReceita2026,
    receitaReal2025: m.receitaReal2025,
    acao: m.acao,
  }));

  return montarComparativoMetaDiariaBlackFriday(metas, receitaRealPorDia, todayBrasiliaStr(new Date()));
}
