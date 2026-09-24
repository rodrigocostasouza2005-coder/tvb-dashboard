import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { todayBrasiliaStr, brasiliaDayStart, brasiliaDayEnd } from "@/lib/filters";
import {
  netByReturns,
  returnWhere,
  saleWhere,
  stockWhere,
  cacheAsync,
  getB2BClienteNomes,
  canalWhere,
  dimensionKey,
  getLastEstoqueSyncTime,
  latestStockSnapshots,
  sortTamanhos,
  groupStoresForFilter,
  resolveLojaNome,
  getStores,
  getAllStores,
  getRawStores,
  getDistinctColecoes,
  getDistinctTamanhos,
  getDistinctGrupos,
  getTamanhosPorGrupo,
  getMarcas,
  getTabelasPreco,
  getLastSyncs,
  getSiteAtacadoStoreIds,
  Dimension,
  DashboardFilters,
  Canal,
  StoreFilterOption,
  HEAVY_QUERY_CACHE_MS,
} from "./core";
import {
  getKpiSummary,
  getMonthlySnapshotKpi,
  getSalesByDay,
  getSalesByDayPerStore,
  getSalesByDayPerColecao,
  getSalesByDimension,
  getSalesByStore,
  getSalesByGrupoProduto,
  getSalesByGrupoProdutoTamanho,
  getReturnsByGrupoProdutoTamanho,
  getSalesByTamanhoProduto,
  getSalesByProdutoTamanho,
  getReturnsByGrupoProduto,
  getReturnsByTamanhoProduto,
  getReturnsByProdutoTamanho,
  getGiftsByDimension,
  getGiftsByGrupoProduto,
  getReturnsByDimension,
  getReturnsByDay,
  getVendedorRanking,
  getMonthlySalesByStore,
  getDailySalesByProduto,
  getMonthlyReturnsTotal,
  getGiftsByCliente,
  getGiftsByDayByStore,
  getTopParaIncentivar,
  getSiteVarejoCidades,
  getReceitaHistoricaExterna,
  getDistribuicaoPedidos,
  getTopVendidosPorLoja,
  getVendasHojeComComparacao,
  getMaisVendidosSemana,
  getTicketPorFaixaMensal,
  getTamanhoMixMensal,
  DailyProdutoPoint,
  DistribuicaoPedidosItem,
} from "./vendas";
import {
  getTotalStock,
  getStockVsSalesCombinado,
  getStockVsSales,
  searchStockVsSales,
  searchStockVsSalesComTamanhos,
  getReplenishment,
  getReplenishmentPorVendas,
  getStockAging,
  getEstoqueAtual,
  getEstoqueAtualPorGrupoProduto,
  getEstoquePorArmazenador,
  getSugestoesRetiradaEstoque,
  getGradeTamanhoBusca,
  getMapaDeComprasDetalhado,
  setCoberturaMeta,
  getCrescimentoEsperado,
  setCrescimentoEsperado,
  getMinimumRules,
  getStockCoverage,
  StockVsSalesCombinadoRow,
  SugestaoRetirada,
  MesMapaCompras,
  MapaComprasProduto,
  MapaComprasGrupo,
} from "./estoque";
import {
  getSellthroughByColecao,
  getSellthroughColecaoDetalhe,
  getColecoes,
  getColecaoCurvaVida,
  CurvaVidaColecao,
} from "./sellthrough";
import {
  getVendedoresAtivos,
  getSugestoesDeContato,
  getFollowUpPosCompra,
  getContatosPorVendedor,
  getVendedores,
  SugestaoContato,
  AtribuicaoInfo,
  FollowUpPosCompra,
  ContatoRealizado,
  ContatoPorVendedor,
} from "./contato-vendedor";
import {
  getAtacadoVendas,
  getAtacadoCidades,
  getAtacadoClientes,
  getAtacadoClienteNomes,
  getAtacadoClienteEvolucao,
  AtacadoClienteEvolucaoMes,
  AtacadoClienteEvolucaoProduto,
  AtacadoClienteEvolucao,
} from "./atacado";


// "Cliente novo" = a 1ª compra dele de todas (sem limite de data, dentro do resto do filtro
// aplicado — loja/marca/tabela de preço/grupo) caiu dentro do período escolhido no filtro de
// data. Pedido do Rodrigo em 2026-08-11 pro card da Visão Geral.
// Primeira compra HISTÓRICA de cada cliente, sem NENHUM filtro de loja/marca/tabela de preço —
// "cliente novo" sempre significa novo pra empresa inteira, nunca só dentro do filtro aplicado
// (decisão do Rodrigo em 2026-08-28, corrigindo um comportamento antigo onde filtrar por 1 loja
// podia marcar como "novo" um cliente que já comprava havia tempo em outra loja/marca). Mesma
// normalização de capitalização de getTopClientes (senão "Gringo"/"GRINGO" contam como 2
// primeiras-compras diferentes). Recebe os nomes JÁ normalizados (trim+upper).
//
// Também considera ClienteCadastro.primeiraCompraExterna (site antigo pré-DAPIC, importado em
// 2026-08-31 via scripts/backfill-primeira-compra-externa.ts) — sem isso, cliente que só voltou
// a comprar recentemente aparecia como "novo" mesmo já sendo cliente desde 2021-2023 (achado
// cruzando por CPF: 226 casos reais). Usa a data mais antiga entre as duas fontes.
// storeIds opcional: quando informado, restringe a busca de 1ª compra em Sale a essas lojas
// (usado pela Visão Geral pra respeitar a restrição de loja do usuário — ver
// getNovosERecorrentesClientes). ClienteCadastro.primeiraCompraExterna não tem loja (dado do
// site antigo pré-DAPIC), então continua sempre global independente de storeIds.
async function getPrimeiraCompraGlobalPorCliente(
  nomesNormalizados: string[],
  storeIds?: string[]
): Promise<Map<string, Date>> {
  if (nomesNormalizados.length === 0) return new Map();
  const [saleRows, externaRows] = await Promise.all([
    storeIds !== undefined
      ? prisma.$queryRaw<{ norm: string; first: Date }[]>`
          SELECT UPPER(TRIM("clienteNome")) AS norm, MIN("saleDate") AS first
          FROM "Sale"
          WHERE UPPER(TRIM("clienteNome")) = ANY(${nomesNormalizados}) AND "storeId" = ANY(${storeIds})
          GROUP BY norm
        `
      : prisma.$queryRaw<{ norm: string; first: Date }[]>`
      SELECT UPPER(TRIM("clienteNome")) AS norm, MIN("saleDate") AS first
      FROM "Sale"
      WHERE UPPER(TRIM("clienteNome")) = ANY(${nomesNormalizados})
      GROUP BY norm
    `,
    prisma.$queryRaw<{ norm: string; first: Date }[]>`
      SELECT UPPER(TRIM("nome")) AS norm, MIN("primeiraCompraExterna") AS first
      FROM "ClienteCadastro"
      WHERE "primeiraCompraExterna" IS NOT NULL AND UPPER(TRIM("nome")) = ANY(${nomesNormalizados})
      GROUP BY norm
    `,
  ]);
  const result = new Map<string, Date>();
  for (const r of saleRows) result.set(r.norm, new Date(r.first));
  for (const r of externaRows) {
    const d = new Date(r.first);
    const cur = result.get(r.norm);
    if (!cur || d < cur) result.set(r.norm, d);
  }
  return result;
}

// Data da venda mais antiga da base — só pra montar a lista de meses disponíveis no seletor de
// período da Segmentação (2026-08-31).
export async function getPrimeiraVendaData(): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ first: Date | null }[]>`SELECT MIN("saleDate") AS first FROM "Sale"`;
  return rows[0]?.first ? new Date(rows[0].first) : null;
}

// Novo = 1ª compra global (considerando também o histórico do site antigo, via
// primeiraCompraExterna) caiu dentro do período filtrado. Recorrente = comprou no período mas já
// tinha comprado antes — pedido do Rodrigo em 2026-09-01 pra ver os dois lado a lado na Visão Geral.
export async function getNovosERecorrentesClientes(filters: DashboardFilters) {
  const where: Prisma.SaleWhereInput = { ...saleWhere(filters), clienteNome: { not: null } };
  const clientesNoPeriodo = await prisma.sale.groupBy({ by: ["clienteNome"], where });
  const normSet = new Set(clientesNoPeriodo.map((c) => (c.clienteNome as string).trim().toUpperCase()));
  const primeiraGlobal = await getPrimeiraCompraGlobalPorCliente([...normSet], filters.storeIds);
  let novos = 0;
  let recorrentes = 0;
  for (const norm of normSet) {
    const first = primeiraGlobal.get(norm);
    if (!first) continue;
    if (first >= filters.from && first <= filters.to) novos++;
    else if (first < filters.from) recorrentes++;
  }
  return { novos, recorrentes };
}

// Devoluções não têm clienteNome no schema, mas dapicVendaId é o mesmo id da venda original
// — junta de volta com Sale (storeId+dapicVendaId) pra descobrir de quem foi cada devolução.
// Devolução é sempre B2C (confirmado pelo Rodrigo em 2026-08-21), então não faz sentido
// chamar isso quando canal="b2b" (líquida = bruta nesse caso, sem devolução nenhuma).
async function getValorDevolvidoPorCliente(filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "from" | "to">) {
  const returns = await prisma.return.findMany({
    where: { ...returnWhere(filters), dapicVendaId: { not: null } },
    select: { storeId: true, dapicVendaId: true, valorTotal: true },
  });
  if (returns.length === 0) return new Map<string, number>();

  const dapicVendaIds = [...new Set(returns.map((r) => r.dapicVendaId as number))];
  const storeIds = [...new Set(returns.map((r) => r.storeId))];
  const sales = await prisma.sale.findMany({
    where: { storeId: { in: storeIds }, dapicVendaId: { in: dapicVendaIds }, clienteNome: { not: null } },
    select: { storeId: true, dapicVendaId: true, clienteNome: true },
  });
  const clienteByVenda = new Map(sales.map((s) => [`${s.storeId}::${s.dapicVendaId}`, s.clienteNome as string]));

  const devolvidoPorCliente = new Map<string, number>();
  for (const r of returns) {
    const cliente = clienteByVenda.get(`${r.storeId}::${r.dapicVendaId}`);
    if (!cliente) continue;
    devolvidoPorCliente.set(cliente, (devolvidoPorCliente.get(cliente) ?? 0) + r.valorTotal);
  }
  return devolvidoPorCliente;
}

// liquido=true desconta devolução da receita (usado só na Lâmina Mensal — pedido do Rodrigo
// em 2026-08-24). Padrão continua bruta pra não mudar o que a aba Clientes já mostra (lá está
// rotulado "Receita bruta").
export async function getTopClientes(
  filters: DashboardFilters,
  vendedor?: string | null,
  limit = 30,
  canal: Canal = "todos",
  liquido = false,
  query?: string
) {
  const q = query?.trim();
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: q ? { contains: q, mode: "insensitive" } : { not: null },
    ...(vendedor ? { vendedor } : {}),
    ...(canal !== "todos" ? { AND: [await canalWhere(canal)] } : {}),
  };
  const [rows, pedidosRows, devolvidoPorCliente] = await Promise.all([
    prisma.sale.groupBy({
      by: ["clienteNome"],
      where,
      _sum: { quantidade: true, valorTotalLiquido: true },
    }),
    // "Pedidos" precisa ser PEDIDO distinto (storeId+dapicVendaId), não linha de item — 1 pedido
    // pode ter vários produtos, cada um sua própria linha em Sale. Contar linhas (_count._all)
    // inflava até 40x em clientes de atacado com pedidos grandes (achado em 2026-08-28).
    prisma.sale.groupBy({ by: ["clienteNome", "storeId", "dapicVendaId"], where }),
    liquido && canal !== "b2b" ? getValorDevolvidoPorCliente(filters) : Promise.resolve(new Map<string, number>()),
  ]);

  // O mesmo cliente às vezes está cadastrado com maiúscula/minúscula diferente no DAPIC (ex:
  // "Gringo" e "GRINGO") — sem normalizar, o groupBy trata como 2 clientes distintos e fragmenta
  // a receita dele em duas linhas. Junta pelo nome normalizado, mantendo como nome de exibição
  // a variante com mais receita (a mais "oficial" das duas).
  type Merged = { cliente: string; unidades: number; receitaBruta: number; devolvido: number; melhorReceita: number; pedidos: Set<string> };
  const merged = new Map<string, Merged>();
  for (const r of rows) {
    const nome = r.clienteNome as string;
    const norm = nome.trim().toUpperCase();
    const unidades = r._sum.quantidade ?? 0;
    const receitaBruta = r._sum.valorTotalLiquido ?? 0;
    const devolvido = devolvidoPorCliente.get(nome) ?? 0;
    const cur = merged.get(norm);
    if (!cur) {
      merged.set(norm, { cliente: nome, unidades, receitaBruta, devolvido, melhorReceita: receitaBruta, pedidos: new Set() });
    } else {
      cur.unidades += unidades;
      cur.receitaBruta += receitaBruta;
      cur.devolvido += devolvido;
      if (receitaBruta > cur.melhorReceita) {
        cur.cliente = nome;
        cur.melhorReceita = receitaBruta;
      }
    }
  }
  for (const p of pedidosRows) {
    const norm = (p.clienteNome as string).trim().toUpperCase();
    merged.get(norm)?.pedidos.add(`${p.storeId}::${p.dapicVendaId}`);
  }

  const sorted = [...merged.values()]
    .map((m) => ({
      cliente: m.cliente,
      pedidos: m.pedidos.size,
      unidades: m.unidades,
      receitaBruta: m.receitaBruta,
      receitaLiquida: liquido ? m.receitaBruta - m.devolvido : m.receitaBruta,
    }))
    .sort((a, b) => (liquido ? b.receitaLiquida - a.receitaLiquida : b.receitaBruta - a.receitaBruta))
    .slice(0, limit);

  // Enriquece com telefone/email da tabela Client (join por nome)
  const nomes = sorted.map((r) => r.cliente);
  const clientesCadastro = await prisma.clienteCadastro.findMany({ where: { nome: { in: nomes } } });
  const cadastroByNome = new Map(clientesCadastro.map((c) => [c.nome, c]));

  return sorted.map((r) => {
    const cad = cadastroByNome.get(r.cliente);
    return {
      ...r,
      telefone: cad?.telefone ?? cad?.celular ?? null,
      email: cad?.email ?? null,
      dataNascimento: cad?.dataNascimento ?? null,
    };
  });
}

// Mesmo mês de início de dado usado na aba Lâmina Mensal (DATA_START_MONTH em
// src/app/dashboard/lamina-mensal/page.tsx) — duplicado aqui de propósito (lib não deve
// depender de arquivo de página).
const TOP_CLIENTES_START_MONTH = "2025-09";

function shiftMonthStr(monthStr: string, delta: number) {
  const [year, m] = monthStr.split("-").map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRangeStr(monthStr: string) {
  const [year, m] = monthStr.split("-").map(Number);
  const from = brasiliaDayStart(`${monthStr}-01`);
  const lastDay = new Date(year, m, 0).getDate();
  const todayStr = todayBrasiliaStr(new Date());
  const isCurrentMonth = todayStr.slice(0, 7) === monthStr;
  const to = isCurrentMonth ? brasiliaDayEnd(todayStr) : brasiliaDayEnd(`${monthStr}-${String(lastDay).padStart(2, "0")}`);
  return { from, to };
}

// Meses em que o cliente apareceu no Top 5 por receita líquida da empresa inteira (mesmo
// critério da aba Lâmina Mensal: todas as lojas/marcas/tabelas, canal "todos") — usado como
// "selo" na Ficha do Cliente. Sempre company-wide, independente da restrição de quem tá vendo a
// ficha, porque é um fato histórico do cliente, não uma visão recortada por permissão.
export async function getClienteTopMeses(clienteNome: string): Promise<string[]> {
  const norm = clienteNome.trim().toUpperCase();
  const hojeStr = todayBrasiliaStr(new Date());
  const mesAtual = hojeStr.slice(0, 7);

  const meses: string[] = [];
  for (let cursor = TOP_CLIENTES_START_MONTH; cursor <= mesAtual; cursor = shiftMonthStr(cursor, 1)) {
    meses.push(cursor);
  }

  const resultados = await Promise.all(
    meses.map(async (mes) => {
      const { from, to } = monthRangeStr(mes);
      const top5 = await getTopClientes({ from, to }, null, 5, "todos", true);
      return top5.some((c) => c.cliente.trim().toUpperCase() === norm) ? mes : null;
    })
  );

  return resultados.filter((m): m is string => m !== null);
}

// ===== CRM de Clientes (2026-08-28) =====

// KPIs da Visão Geral do CRM: ativos, novos (mesma regra de getNewClientsCount — 1ª compra da
// empresa inteira caiu no período), recorrentes (2+ pedidos, não-novo), ocasionais (1 pedido,
// não-novo), ticket médio, unidades por pedido, receita média por cliente.
export type ClientesCrmOverview = {
  ativos: number;
  novos: number;
  recorrentes: number;
  ocasionais: number;
  pedidos: number;
  unidades: number;
  receitaBruta: number;
  receitaLiquida: number;
  // ticketMedio e receitaMediaPorCliente usam líquida — pedido do Rodrigo em 2026-08-28.
  ticketMedio: number;
  unidadesPorPedido: number;
  receitaMediaPorCliente: number;
};

// vendedor opcional (2026-09-16, achado do Rodrigo): a aba Clientes tem um filtro de vendedor
// que só afetava a tabela "Top clientes" e os Aniversariantes — os KPIs do topo (Clientes
// ativos/Novos/Recorrentes/Ticket médio) ficavam sempre iguais independente do vendedor
// escolhido, parecendo que o filtro "não funcionava".
export async function getClientesCrmOverview(
  filters: DashboardFilters,
  canal: Canal = "todos",
  vendedor?: string | null
): Promise<ClientesCrmOverview> {
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(vendedor ? { vendedor } : {}),
    ...(canal !== "todos" ? { AND: [await canalWhere(canal)] } : {}),
  };

  const [porPedido, devolvidoPorCliente] = await Promise.all([
    prisma.sale.groupBy({
      by: ["clienteNome", "storeId", "dapicVendaId"],
      where,
      _sum: { quantidade: true, valorTotalLiquido: true },
    }),
    canal !== "b2b" ? getValorDevolvidoPorCliente(filters) : Promise.resolve(new Map<string, number>()),
  ]);

  const porClienteNorm = new Map<string, { pedidos: Set<string>; unidades: number; receita: number; devolvido: number }>();
  for (const r of porPedido) {
    const norm = (r.clienteNome as string).trim().toUpperCase();
    const cur = porClienteNorm.get(norm) ?? { pedidos: new Set<string>(), unidades: 0, receita: 0, devolvido: 0 };
    cur.pedidos.add(`${r.storeId}::${r.dapicVendaId}`);
    cur.unidades += r._sum.quantidade ?? 0;
    cur.receita += r._sum.valorTotalLiquido ?? 0;
    porClienteNorm.set(norm, cur);
  }
  // getValorDevolvidoPorCliente é por nome BRUTO (pode ter variante de capitalização diferente
  // da usada como chave normalizada acima) — soma dentro do bucket normalizado certo.
  for (const [nomeRaw, valor] of devolvidoPorCliente) {
    const cur = porClienteNorm.get(nomeRaw.trim().toUpperCase());
    if (cur) cur.devolvido += valor;
  }

  const primeiraGlobal = await getPrimeiraCompraGlobalPorCliente([...porClienteNorm.keys()]);

  let novos = 0, recorrentes = 0, ocasionais = 0;
  let totalPedidos = 0, totalUnidades = 0, totalReceitaBruta = 0, totalDevolvido = 0;
  for (const [norm, v] of porClienteNorm) {
    const first = primeiraGlobal.get(norm);
    const isNovo = first !== undefined && first >= filters.from && first <= filters.to;
    if (isNovo) novos++;
    else if (v.pedidos.size >= 2) recorrentes++;
    else ocasionais++;
    totalPedidos += v.pedidos.size;
    totalUnidades += v.unidades;
    totalReceitaBruta += v.receita;
    totalDevolvido += v.devolvido;
  }
  const totalReceitaLiquida = totalReceitaBruta - totalDevolvido;

  const ativos = porClienteNorm.size;
  return {
    ativos,
    novos,
    recorrentes,
    ocasionais,
    pedidos: totalPedidos,
    unidades: totalUnidades,
    receitaBruta: totalReceitaBruta,
    receitaLiquida: totalReceitaLiquida,
    ticketMedio: totalPedidos > 0 ? totalReceitaLiquida / totalPedidos : 0,
    unidadesPorPedido: totalPedidos > 0 ? totalUnidades / totalPedidos : 0,
    receitaMediaPorCliente: ativos > 0 ? totalReceitaLiquida / ativos : 0,
  };
}

export type ClienteSegmento = "novo" | "vip" | "recorrente" | "em_risco" | "ocasional" | "inativo";

export type ClienteSegmentado = {
  cliente: string;
  telefone: string | null;
  grupoPrincipal: string | null;
  lojaPrincipal: string | null;
  recenciaDias: number;
  pedidos: number;
  receitaBruta: number;
  segmento: ClienteSegmento;
};

// Segmentação tipo RFM (Recência/Frequência/Valor) sem expor a sigla pro usuário — pedido do
// Rodrigo em 2026-08-28. Limiares calibrados contra a distribuição real da base (não são "regra
// de livro"): medi em 2026-08-28 que a mediana de recência é ~172 dias e 65% dos clientes tem
// só 1 pedido na vida toda — um corte tipo "90 dias = inativo" classificaria a maioria da base
// inteira como inativa, então os limiares abaixo (90/180 dias) foram escolhidos olhando esses
// percentis reais, não um valor arbitrário de manual de CRM.
//
// Usa o HISTÓRICO COMPLETO (ignora from/to do filtro) pra recência/frequência/valor E pra
// "novo" — só respeita loja/marca/tabela/canal do filtro. Sem isso, filtrar "últimos 30 dias"
// faria todo mundo parecer "recente", e usar from/to pra "novo" quebrava com o período padrão
// (que cobre o histórico inteiro desde set/2025) — todo cliente virava "novo" porque a 1ª
// compra de qualquer um sempre cai dentro de um período tão largo (achado testando em
// 2026-08-28: Segmentação toda zerada em VIP/Recorrente/etc, tudo empurrado pra "novo"). "Novo"
// aqui sempre usa uma janela fixa dos últimos NOVO_DIAS a partir de "referenceDate", não do
// período selecionado — sempre olhando a 1ª compra da empresa inteira (mesmo critério de
// getNewClientsCount), não só dentro do filtro de loja/marca/tabela.
//
// referenceDate = "foto tirada em que data" (pedido do Rodrigo em 2026-08-31, seletor de
// mês/período na Segmentação). Default é agora (comportamento de sempre). Quando é um mês
// passado, vira uma reconstrução histórica: todo o cálculo (recência, pedidos, receita, corte de
// VIP e a janela de "novo") passa a olhar só até o fim daquele mês, como se estivéssemos ali —
// SEM restringir a query a vendas só DAQUELE mês, senão um cliente antigo que não comprou
// especificamente naquele mês sumiria ou virataria "novo" por engano (exemplo do Rodrigo). O
// histórico anterior ao mês continua 100% visível pro cálculo, só o futuro (depois do mês) que
// fica de fora.
// vendedor opcional (2026-09-18, aba Sugestões de Contato): mesmo padrão já usado em
// getClientesCrmOverview/getClienteRetencaoVarejo/getDistribuicaoPedidos/getAniversariantesDoMes
// — filtra a origem (Sale.vendedor) antes de agregar, então recência/segmento/loja principal
// já saem calculados só sobre as vendas daquele vendedor.
export async function getClienteSegmentacao(
  filters: DashboardFilters,
  canal: Canal = "todos",
  referenceDate: Date = new Date(),
  vendedor?: string | null
): Promise<ClienteSegmentado[]> {
  const key = `segmentacao:${canal}:${referenceDate.toISOString().slice(0, 10)}:${vendedor ?? ""}:${JSON.stringify({
    storeIds: filters.storeIds, marcas: filters.marcas, tabelasPreco: filters.tabelasPreco,
  })}`;
  return cacheAsync(key, HEAVY_QUERY_CACHE_MS, () => computeClienteSegmentacao(filters, canal, referenceDate, vendedor));
}

async function computeClienteSegmentacao(
  filters: DashboardFilters,
  canal: Canal,
  referenceDate: Date,
  vendedor?: string | null
): Promise<ClienteSegmentado[]> {
  const allTime: DashboardFilters = { ...filters, from: new Date(0), to: referenceDate };
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(allTime),
    clienteNome: { not: null },
    ...(vendedor ? { vendedor } : {}),
    ...(canal !== "todos" ? { AND: [await canalWhere(canal)] } : {}),
  };
  const rows = await prisma.sale.findMany({
    where,
    select: {
      clienteNome: true, saleDate: true, dapicVendaId: true, storeId: true, valorTotalLiquido: true, quantidade: true, grupo: true,
      store: { select: { name: true, displayGroup: true } },
    },
  });

  const byCliente = new Map<string, { nome: string; last: Date; pedidos: Set<string>; receita: number; porGrupo: Map<string, number>; porLoja: Map<string, number> }>();
  for (const r of rows) {
    const nome = r.clienteNome as string;
    const norm = nome.trim().toUpperCase();
    const cur = byCliente.get(norm) ?? { nome, last: r.saleDate, pedidos: new Set<string>(), receita: 0, porGrupo: new Map<string, number>(), porLoja: new Map<string, number>() };
    if (r.saleDate > cur.last) cur.last = r.saleDate;
    cur.pedidos.add(`${r.storeId}::${r.dapicVendaId}`);
    cur.receita += r.valorTotalLiquido;
    cur.porGrupo.set(r.grupo, (cur.porGrupo.get(r.grupo) ?? 0) + r.quantidade);
    const loja = r.store.displayGroup ?? r.store.name;
    cur.porLoja.set(loja, (cur.porLoja.get(loja) ?? 0) + r.quantidade);
    byCliente.set(norm, cur);
  }
  if (byCliente.size === 0) return [];

  // Pedidos/receita do site antigo (vnda) somam em cima do que o cliente já tem no DAPIC — pedido
  // do Rodrigo em 2026-08-31, mesmo raciocínio da Retenção: só entra em quem já existe aqui via
  // DAPIC (não cria cliente "fantasma" só de histórico antigo sem nenhuma compra atual). Sem
  // loja/marca/tabela/canal — essas dimensões não existem pro vnda.
  const historico = await prisma.vendaHistoricaExterna.findMany({
    where: { saleDate: { lte: referenceDate } },
    select: { clienteNome: true, pedidoExterno: true, valorTotal: true },
  });
  for (const h of historico) {
    const norm = h.clienteNome.trim().toUpperCase();
    const cur = byCliente.get(norm);
    if (!cur) continue;
    cur.pedidos.add(`vnda::${h.pedidoExterno}`);
    cur.receita += h.valorTotal;
  }

  const primeiraGlobal = await getPrimeiraCompraGlobalPorCliente([...byCliente.keys()]);
  // Telefone — mesmo enriquecimento de getTopClientes (join por nome com ClienteCadastro).
  const nomesRaw = [...byCliente.values()].map((c) => c.nome);
  const cadastros = await prisma.clienteCadastro.findMany({ where: { nome: { in: nomesRaw } } });
  const cadastroByNome = new Map(cadastros.map((c) => [c.nome, c]));

  const now = referenceDate;
  const receitaOrdenada = [...byCliente.values()].map((c) => c.receita).sort((a, b) => b - a);
  const corteVip = receitaOrdenada[Math.max(0, Math.floor(receitaOrdenada.length * 0.1) - 1)] ?? Infinity;

  const RECENCIA_ATIVO_DIAS = 90;
  const RECENCIA_INATIVO_DIAS = 180;
  const NOVO_DIAS = 60;

  return [...byCliente.entries()].map(([norm, c]) => {
    const recenciaDias = Math.floor((now.getTime() - c.last.getTime()) / 86400000);
    const pedidos = c.pedidos.size;
    const primeiraCompra = primeiraGlobal.get(norm);
    const diasDesdePrimeiraCompra = primeiraCompra ? Math.floor((now.getTime() - primeiraCompra.getTime()) / 86400000) : Infinity;
    const isNovo = diasDesdePrimeiraCompra <= NOVO_DIAS;

    let segmento: ClienteSegmento;
    if (isNovo) segmento = "novo";
    else if (recenciaDias > RECENCIA_INATIVO_DIAS) segmento = "inativo";
    else if (c.receita >= corteVip) segmento = "vip";
    else if (pedidos >= 2 && recenciaDias <= RECENCIA_ATIVO_DIAS) segmento = "recorrente";
    else if (pedidos >= 2) segmento = "em_risco";
    else segmento = "ocasional";

    const grupoPrincipal = [...c.porGrupo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const lojaPrincipal = [...c.porLoja.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const cad = cadastroByNome.get(c.nome);

    return {
      cliente: c.nome,
      telefone: cad?.telefone ?? cad?.celular ?? null,
      grupoPrincipal,
      lojaPrincipal,
      recenciaDias,
      pedidos,
      receitaBruta: c.receita,
      segmento,
    };
  });
}

// Produtos comprados (líquido) por um lote de clientes — pedido do Rodrigo em 2026-08-31 pra
// dropdown na lista de Segmentação. Em lote (1 query pra todos os clientes da tela, nunca 1 por
// linha) — mesma ideia de getClienteFicha, mas resolvido pra N clientes de uma vez em vez de 1.
// Sempre histórico completo (mesmo critério de "primeira compra"/segmentação — não é o período do
// filtro), respeitando loja/marca/tabela do filtro atual.
export async function getProdutosLiquidosPorClientes(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "tabelasPreco" | "grupoIn">,
  nomesClientes: string[]
): Promise<Map<string, { produto: string; unidades: number }[]>> {
  if (nomesClientes.length === 0) return new Map();
  const normalizedTargets = [...new Set(nomesClientes.map((n) => n.trim().toUpperCase()))];

  const variantRows = await prisma.$queryRaw<{ nome: string; norm: string }[]>`
    SELECT DISTINCT "clienteNome" AS nome, UPPER(TRIM("clienteNome")) AS norm
    FROM "Sale"
    WHERE UPPER(TRIM("clienteNome")) = ANY(${normalizedTargets})
  `;
  if (variantRows.length === 0) return new Map();
  const variantToNorm = new Map(variantRows.map((r) => [r.nome, r.norm]));
  const allVariants = variantRows.map((r) => r.nome);

  const allTime: DashboardFilters = { ...filters, from: new Date(0), to: new Date() };
  const where: Prisma.SaleWhereInput = { ...saleWhere(allTime), clienteNome: { in: allVariants } };
  const sales = await prisma.sale.findMany({
    where,
    select: { clienteNome: true, produto: true, quantidade: true, storeId: true, dapicVendaId: true },
  });
  if (sales.length === 0) return new Map();

  const porClienteProduto = new Map<string, Map<string, number>>();
  const pedidoToCliente = new Map<string, string>();
  for (const s of sales) {
    const norm = variantToNorm.get(s.clienteNome as string) ?? (s.clienteNome as string).trim().toUpperCase();
    const m = porClienteProduto.get(norm) ?? new Map<string, number>();
    m.set(s.produto, (m.get(s.produto) ?? 0) + s.quantidade);
    porClienteProduto.set(norm, m);
    pedidoToCliente.set(`${s.storeId}::${s.dapicVendaId}`, norm);
  }

  // Devolução — junta por storeId+dapicVendaId (Return não tem clienteNome) usando o mapa de
  // pedido→cliente que já montamos acima, então dá pra atribuir certo com 1 query só pra todos.
  const storeIds = [...new Set(sales.map((s) => s.storeId))];
  const vendaIds = [...new Set(sales.map((s) => s.dapicVendaId))];
  const returns = await prisma.return.findMany({
    where: { storeId: { in: storeIds }, dapicVendaId: { in: vendaIds } },
    select: { storeId: true, dapicVendaId: true, produto: true, quantidade: true },
  });
  for (const r of returns) {
    const norm = pedidoToCliente.get(`${r.storeId}::${r.dapicVendaId}`);
    if (!norm) continue;
    const m = porClienteProduto.get(norm);
    if (!m) continue;
    m.set(r.produto, (m.get(r.produto) ?? 0) - r.quantidade);
  }

  const result = new Map<string, { produto: string; unidades: number }[]>();
  for (const [norm, m] of porClienteProduto) {
    result.set(
      norm,
      [...m.entries()]
        .map(([produto, unidades]) => ({ produto, unidades }))
        .filter((p) => p.unidades !== 0)
        .sort((a, b) => b.unidades - a.unidades)
    );
  }
  return result;
}

// Pra cada cliente, acha o tamanho que ele mais compra DENTRO do produto informado (geralmente o
// produtoFavorito) e checa se ainda tem esse tamanho disponível na loja principal dele — pedido
// do Rodrigo em 2026-09-08: "cruzar com o que temos em estoque, se o tamanho da pessoa ainda tem".
// Só devolve `disponivel: true` quando bate de verdade (produto E tamanho E loja), nunca chuta —
// a mensagem só menciona estoque quando isso vier preenchido.
export async function getTamanhoEstoqueParaClientes(
  itens: { cliente: string; produto: string; loja: string | null }[]
): Promise<Map<string, { tamanho: string; disponivel: boolean }>> {
  const result = new Map<string, { tamanho: string; disponivel: boolean }>();
  if (itens.length === 0) return result;

  const normalizedTargets = [...new Set(itens.map((i) => i.cliente.trim().toUpperCase()))];
  const produtos = [...new Set(itens.map((i) => i.produto))];

  const variantRows = await prisma.$queryRaw<{ nome: string; norm: string }[]>`
    SELECT DISTINCT "clienteNome" AS nome, UPPER(TRIM("clienteNome")) AS norm
    FROM "Sale"
    WHERE UPPER(TRIM("clienteNome")) = ANY(${normalizedTargets})
  `;
  if (variantRows.length === 0) return result;
  const allVariants = variantRows.map((r) => r.nome);

  // Tamanho mais comprado por cliente+produto (todo o histórico, mesma janela de produtoFavorito).
  const vendas = await prisma.sale.groupBy({
    by: ["clienteNome", "produto", "tamanho"],
    where: { clienteNome: { in: allVariants }, produto: { in: produtos }, tamanho: { not: null } },
    _sum: { quantidade: true },
  });
  const tamanhoPorClienteProduto = new Map<string, Map<string, number>>();
  for (const v of vendas) {
    const norm = (v.clienteNome as string).trim().toUpperCase();
    const key = `${norm}::${v.produto}`;
    const m = tamanhoPorClienteProduto.get(key) ?? new Map<string, number>();
    m.set(v.tamanho as string, (m.get(v.tamanho as string) ?? 0) + (v._sum.quantidade ?? 0));
    tamanhoPorClienteProduto.set(key, m);
  }

  // Resolve "loja principal" (nome de exibição, pode agrupar mais de 1 loja física) de volta
  // pros storeIds reais — StockSnapshot guarda por loja física, não por displayGroup.
  const stores = await prisma.store.findMany();
  const storeIdsPorNomeExibicao = new Map<string, string[]>();
  for (const s of stores) {
    const nome = s.displayGroup ?? s.name;
    const arr = storeIdsPorNomeExibicao.get(nome) ?? [];
    arr.push(s.id);
    storeIdsPorNomeExibicao.set(nome, arr);
  }

  const estoque = await prisma.stockSnapshot.findMany({
    where: { produto: { in: produtos } },
    select: { storeId: true, produto: true, tamanho: true, quantidadeDisponivel: true },
  });
  const estoquePorProdutoTamanhoLoja = new Map<string, number>();
  for (const e of estoque) {
    const key = `${e.produto}::${e.tamanho ?? ""}::${e.storeId}`;
    estoquePorProdutoTamanhoLoja.set(key, (estoquePorProdutoTamanhoLoja.get(key) ?? 0) + e.quantidadeDisponivel);
  }

  for (const item of itens) {
    const norm = item.cliente.trim().toUpperCase();
    const tamanhos = tamanhoPorClienteProduto.get(`${norm}::${item.produto}`);
    const tamanhoTop = tamanhos ? [...tamanhos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
    if (!tamanhoTop || !item.loja) continue;
    const storeIds = storeIdsPorNomeExibicao.get(item.loja) ?? [];
    const disponivel = storeIds.some((id) => (estoquePorProdutoTamanhoLoja.get(`${item.produto}::${tamanhoTop}::${id}`) ?? 0) > 0);
    result.set(norm, { tamanho: tamanhoTop, disponivel });
  }
  return result;
}

export type ClientePrecoBehavior = "full_price" | "promo_driven" | "mixed" | "sem_dado";

// Tabelas reais confirmadas em produção em 2026-08-28 (Sale.tabelaPreco): "Tabela varejo",
// "Tabela atacado", "Promoção", "Black Friday 2025", mais null (tabela não inferida — 43-81%
// das vendas por mês, taxa alta e constante, não é só resíduo de backfill antigo).
const TABELAS_PROMOCIONAIS = new Set(["Promoção", "Black Friday 2025"]);
const TABELAS_CHEIAS = new Set(["Tabela varejo", "Tabela atacado"]);
// Cliente só recebe rótulo se tiver pelo menos essa quantidade de vendas com tabela
// identificada — com a taxa de null alta, classificar com 1-2 vendas seria pouco confiável.
const MIN_VENDAS_COM_TABELA = 3;

function classificarComportamentoPreco(receitaCheio: number, receitaPromo: number, vendasComTabela: number): ClientePrecoBehavior {
  if (vendasComTabela < MIN_VENDAS_COM_TABELA) return "sem_dado";
  const total = receitaCheio + receitaPromo;
  if (total <= 0) return "sem_dado";
  const pctPromo = receitaPromo / total;
  if (pctPromo >= 0.8) return "promo_driven";
  if (pctPromo <= 0.2) return "full_price";
  return "mixed";
}

// Full Price / Promo Driven / Mixed por cliente, em massa (usado na Segmentação da CRM). Só
// classifica quem tem dado suficiente (ver MIN_VENDAS_COM_TABELA) — o resto vira "sem_dado" em
// vez de arriscar um rótulo errado com pouca informação.
export async function getClientesPrecoBehavior(
  filters: DashboardFilters,
  canal: Canal = "todos"
): Promise<Map<string, ClientePrecoBehavior>> {
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(canal !== "todos" ? { AND: [await canalWhere(canal)] } : {}),
  };
  const rows = await prisma.sale.groupBy({
    by: ["clienteNome", "tabelaPreco"],
    where,
    _sum: { valorTotalLiquido: true },
    _count: { _all: true },
  });

  const byCliente = new Map<string, { cheio: number; promo: number; comTabela: number }>();
  for (const r of rows) {
    const norm = (r.clienteNome as string).trim().toUpperCase();
    const cur = byCliente.get(norm) ?? { cheio: 0, promo: 0, comTabela: 0 };
    if (r.tabelaPreco !== null) {
      cur.comTabela += r._count._all;
      const valor = r._sum.valorTotalLiquido ?? 0;
      if (TABELAS_PROMOCIONAIS.has(r.tabelaPreco)) cur.promo += valor;
      else if (TABELAS_CHEIAS.has(r.tabelaPreco)) cur.cheio += valor;
    }
    byCliente.set(norm, cur);
  }

  const result = new Map<string, ClientePrecoBehavior>();
  for (const [norm, v] of byCliente) {
    result.set(norm, classificarComportamentoPreco(v.cheio, v.promo, v.comTabela));
  }
  return result;
}

// "Quem compra esse produto/grupo?" — mesmo padrão de normalização de getTopClientes, mas
// agrupado por produto/grupo específico em vez do total do cliente.
export async function getClientesPorDimensao(
  filters: DashboardFilters,
  dimension: "produto" | "grupo",
  keys: string[],
  canal: Canal = "todos",
  limit = 20
) {
  if (keys.length === 0) return [];
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(dimension === "produto" ? { produto: { in: keys } } : { grupo: { in: keys } }),
    ...(canal !== "todos" ? { AND: [await canalWhere(canal)] } : {}),
  };
  const rows = await prisma.sale.groupBy({
    by: ["clienteNome"],
    where,
    _sum: { quantidade: true, valorTotalLiquido: true },
  });

  const merged = new Map<string, { cliente: string; unidades: number; receita: number }>();
  for (const r of rows) {
    const nome = r.clienteNome as string;
    const norm = nome.trim().toUpperCase();
    const unidades = r._sum.quantidade ?? 0;
    const receita = r._sum.valorTotalLiquido ?? 0;
    const cur = merged.get(norm);
    if (!cur) {
      merged.set(norm, { cliente: nome, unidades, receita });
    } else {
      cur.unidades += unidades;
      cur.receita += receita;
    }
  }
  const sorted = [...merged.values()].sort((a, b) => b.receita - a.receita).slice(0, limit);

  // Telefone — mesmo enriquecimento de getTopClientes (pedido do Rodrigo em 2026-08-28: telefone
  // em toda visão que lista cliente).
  const nomes = sorted.map((r) => r.cliente);
  const cadastros = await prisma.clienteCadastro.findMany({ where: { nome: { in: nomes } } });
  const cadastroByNome = new Map(cadastros.map((c) => [c.nome, c]));
  return sorted.map((r) => {
    const cad = cadastroByNome.get(r.cliente);
    return { ...r, telefone: cad?.telefone ?? cad?.celular ?? null };
  });
}

export type CrossSellResumo = {
  totalClientes: number;
  unidadesBrutas: number;
  unidadesLiquidas: number;
  receitaBruta: number;
  receitaLiquida: number;
};

export type CrossSellItem = {
  key: string;
  unidadesBrutas: number;
  unidadesLiquidas: number;
  receitaBruta: number;
  receitaLiquida: number;
};

export type CrossSellResult = {
  resumo: CrossSellResumo;
  produtosRelacionados: CrossSellItem[];
  gruposRelacionados: CrossSellItem[];
};

// Cross-sell: "quem comprou X, o que mais compra?" — pedido do Rodrigo em 2026-08-31. Reutiliza
// saleWhere/canalWhere (mesma regra B2B/B2C oficial de sempre) e o mesmo padrão de netagem de
// devolução por produto/grupo já usado em getClienteFicha (junta Return por storeId+dapicVendaId,
// já que Return não tem clienteNome).
//
// Passo a passo: 1) acha quem comprou os produtos/grupos selecionados (dimension+keys) dentro do
// filtro/canal; 2) busca TODAS as compras desses clientes no mesmo filtro/canal (não só do que
// selecionou — é isso que vira a base do cross-sell); 3) agrega por produto e por grupo; 4) neta
// devolução (sempre B2C — pedidos.length 0 em canal="b2b" pula a query inteira, mesma regra usada
// em getClientesCrmOverview); 5) exclui os próprios produtos/grupos selecionados do ranking da
// MESMA dimensão (não teria sentido dizer "quem compra Camisa X também compra Camisa X").
export async function getCrossSellPorDimensao(
  filters: DashboardFilters,
  dimension: "produto" | "grupo",
  keys: string[],
  canal: Canal = "todos",
  limit = 20
): Promise<CrossSellResult> {
  const vazio: CrossSellResult = {
    resumo: { totalClientes: 0, unidadesBrutas: 0, unidadesLiquidas: 0, receitaBruta: 0, receitaLiquida: 0 },
    produtosRelacionados: [],
    gruposRelacionados: [],
  };
  if (keys.length === 0) return vazio;

  const baseWhere: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(canal !== "todos" ? { AND: [await canalWhere(canal)] } : {}),
  };

  const compradoresRows = await prisma.sale.groupBy({
    by: ["clienteNome"],
    where: { ...baseWhere, ...(dimension === "produto" ? { produto: { in: keys } } : { grupo: { in: keys } }) },
  });
  if (compradoresRows.length === 0) return vazio;
  const normalizedSet = new Set(compradoresRows.map((r) => (r.clienteNome as string).trim().toUpperCase()));

  const variantRows = await prisma.$queryRaw<{ nome: string }[]>`
    SELECT DISTINCT "clienteNome" AS nome FROM "Sale" WHERE UPPER(TRIM("clienteNome")) = ANY(${[...normalizedSet]})
  `;
  const variantes = variantRows.map((r) => r.nome);

  // TUDO que esses clientes compraram no mesmo período/filtro/canal — não só o produto/grupo
  // selecionado. É a base do "o que mais eles compram".
  const todasComprasRows = await prisma.sale.findMany({
    where: { ...baseWhere, clienteNome: { in: variantes } },
    select: { storeId: true, dapicVendaId: true, produto: true, grupo: true, quantidade: true, valorTotalLiquido: true },
  });

  const porProduto = new Map<string, { unidades: number; receita: number }>();
  const porGrupo = new Map<string, { unidades: number; receita: number }>();
  const pedidoKeys = new Set<string>();
  const storeIdsCliente = new Set<string>();
  const dapicVendaIdsCliente = new Set<number>();
  for (const s of todasComprasRows) {
    const p = porProduto.get(s.produto) ?? { unidades: 0, receita: 0 };
    p.unidades += s.quantidade;
    p.receita += s.valorTotalLiquido;
    porProduto.set(s.produto, p);

    const g = porGrupo.get(s.grupo) ?? { unidades: 0, receita: 0 };
    g.unidades += s.quantidade;
    g.receita += s.valorTotalLiquido;
    porGrupo.set(s.grupo, g);

    pedidoKeys.add(`${s.storeId}::${s.dapicVendaId}`);
    storeIdsCliente.add(s.storeId);
    dapicVendaIdsCliente.add(s.dapicVendaId);
  }

  // Devolução é sempre B2C (regra confirmada com o Rodrigo) — em canal="b2b" não existe, pula a
  // query. Junta por storeId+dapicVendaId (Return não tem clienteNome) restrito aos pedidos
  // desses clientes especificamente.
  const devolvidoPorProduto = new Map<string, { unidades: number; valor: number }>();
  const devolvidoPorGrupo = new Map<string, { unidades: number; valor: number }>();
  if (canal !== "b2b" && pedidoKeys.size > 0) {
    const returns = await prisma.return.findMany({
      where: { storeId: { in: [...storeIdsCliente] }, dapicVendaId: { in: [...dapicVendaIdsCliente] } },
      select: { storeId: true, dapicVendaId: true, produto: true, grupo: true, quantidade: true, valorTotal: true },
    });
    for (const r of returns) {
      if (!pedidoKeys.has(`${r.storeId}::${r.dapicVendaId}`)) continue;
      const p = devolvidoPorProduto.get(r.produto) ?? { unidades: 0, valor: 0 };
      p.unidades += r.quantidade;
      p.valor += r.valorTotal;
      devolvidoPorProduto.set(r.produto, p);

      const g = devolvidoPorGrupo.get(r.grupo) ?? { unidades: 0, valor: 0 };
      g.unidades += r.quantidade;
      g.valor += r.valorTotal;
      devolvidoPorGrupo.set(r.grupo, g);
    }
  }

  // Resumo do produto/grupo selecionado (líquido) — extrai dos mesmos mapas acima, já que
  // todasComprasRows inclui a compra do produto/grupo selecionado também.
  let resumoUnidadesBrutas = 0, resumoUnidadesLiquidas = 0, resumoReceitaBruta = 0, resumoReceitaLiquida = 0;
  for (const key of keys) {
    const bruto = dimension === "produto" ? porProduto.get(key) : porGrupo.get(key);
    if (!bruto) continue;
    const dev = (dimension === "produto" ? devolvidoPorProduto.get(key) : devolvidoPorGrupo.get(key)) ?? { unidades: 0, valor: 0 };
    resumoUnidadesBrutas += bruto.unidades;
    resumoUnidadesLiquidas += bruto.unidades - dev.unidades;
    resumoReceitaBruta += bruto.receita;
    resumoReceitaLiquida += bruto.receita - dev.valor;
  }

  const keysSet = new Set(keys);
  const produtosRelacionados = [...porProduto.entries()]
    .filter(([produto]) => !(dimension === "produto" && keysSet.has(produto)))
    .map(([produto, v]) => {
      const dev = devolvidoPorProduto.get(produto) ?? { unidades: 0, valor: 0 };
      return {
        key: produto,
        unidadesBrutas: v.unidades,
        unidadesLiquidas: v.unidades - dev.unidades,
        receitaBruta: v.receita,
        receitaLiquida: v.receita - dev.valor,
      };
    })
    .filter((p) => p.unidadesLiquidas !== 0)
    .sort((a, b) => b.receitaLiquida - a.receitaLiquida)
    .slice(0, limit);

  const gruposRelacionados = [...porGrupo.entries()]
    .filter(([grupo]) => !(dimension === "grupo" && keysSet.has(grupo)))
    .map(([grupo, v]) => {
      const dev = devolvidoPorGrupo.get(grupo) ?? { unidades: 0, valor: 0 };
      return {
        key: grupo,
        unidadesBrutas: v.unidades,
        unidadesLiquidas: v.unidades - dev.unidades,
        receitaBruta: v.receita,
        receitaLiquida: v.receita - dev.valor,
      };
    })
    .filter((g) => g.unidadesLiquidas !== 0)
    .sort((a, b) => b.receitaLiquida - a.receitaLiquida);

  return {
    resumo: {
      totalClientes: normalizedSet.size,
      unidadesBrutas: resumoUnidadesBrutas,
      unidadesLiquidas: resumoUnidadesLiquidas,
      receitaBruta: resumoReceitaBruta,
      receitaLiquida: resumoReceitaLiquida,
    },
    produtosRelacionados,
    gruposRelacionados,
  };
}

export type ProdutoEntradaItem = {
  produto: string;
  clientes: number;
  unidades: number;
  receita: number;
};

export type ProdutosEntradaResult = {
  primeiraCompra: ProdutoEntradaItem[];
  compradorUnico: ProdutoEntradaItem[];
};

// "Produtos de Entrada" — pedido do Rodrigo em 2026-08-31: não é "o que mais vende" nem
// cross-sell, é "que produto mais TRAZ cliente novo". Duas visões, pedidas juntas:
// 1) primeiraCompra: pra cada cliente, o produto da 1ª linha de venda dele (cronologicamente) —
//    simplificação deliberada: se o 1º pedido tiver vários produtos, conta só o 1º item (por
//    saleDate, empate resolvido por dapicVendaId) — o caso de "1º pedido com vários produtos
//    diferentes no mesmo instante" é raro e não vale a complexidade de contar todos.
// 2) compradorUnico: o mesmo recorte, restrito a clientes com exatamente 1 pedido NA VIDA TODA
//    (nunca voltaram) — como a primeira compra desses é também a única, reusa a mesma linha, sem
//    query extra.
// "Primeira compra" é sempre GLOBAL (sem filtro de loja/marca/tabela/período) — mesmo critério de
// "cliente novo" já usado no resto do CRM (decisão do Rodrigo em 2026-08-28). Os filtros da
// página (loja/marca/tabela/canal/período) só decidem se AQUELA linha entra no ranking, nunca
// qual foi a primeira. Não neta devolução — a pergunta é "esse produto trouxe o cliente pra
// dentro", uma devolução posterior não desfaz a aquisição.
export async function getProdutosPortaDeEntrada(
  filters: DashboardFilters,
  canal: Canal = "todos",
  limit = 20
): Promise<ProdutosEntradaResult> {
  const [firstRows, pedidoCounts] = await Promise.all([
    prisma.$queryRaw<
      { norm: string; produto: string; grupo: string; storeId: string; marca: string | null; tabelaPreco: string | null; saleDate: Date; quantidade: number; valorTotalLiquido: number }[]
    >`
      SELECT DISTINCT ON (norm)
        norm, produto, grupo, "storeId", marca, "tabelaPreco", "saleDate", quantidade, "valorTotalLiquido"
      FROM (
        SELECT
          UPPER(TRIM("clienteNome")) AS norm, "produto", "grupo", "storeId", "marca", "tabelaPreco",
          "saleDate", "quantidade", "valorTotalLiquido", "dapicVendaId"
        FROM "Sale"
        WHERE "clienteNome" IS NOT NULL
      ) t
      ORDER BY norm, "saleDate" ASC, "dapicVendaId" ASC
    `,
    prisma.$queryRaw<{ norm: string; pedidos: bigint }[]>`
      SELECT UPPER(TRIM("clienteNome")) AS norm, COUNT(DISTINCT ("storeId", "dapicVendaId")) AS pedidos
      FROM "Sale"
      WHERE "clienteNome" IS NOT NULL
      GROUP BY norm
    `,
  ]);
  const pedidosByNorm = new Map(pedidoCounts.map((r) => [r.norm, Number(r.pedidos)]));

  // Cliente atacado "de verdade" (mesma regra de canalWhere) — pega os que já negociaram preço
  // próprio e por isso não batem com "Tabela atacado" só olhando a linha (ver comentário em
  // canalWhere). "norm" já vem normalizado da query acima.
  const b2bNormSet =
    canal !== "todos" ? new Set([...(await getB2BClienteNomes())].map((n) => n.trim().toUpperCase())) : null;

  function passaFiltro(r: (typeof firstRows)[number]): boolean {
    if (r.saleDate < filters.from || r.saleDate > filters.to) return false;
    if (filters.storeIds !== undefined && !filters.storeIds.includes(r.storeId)) return false;
    if (filters.marcas !== undefined && (r.marca === null || !filters.marcas.includes(r.marca))) return false;
    if (filters.tabelasPreco !== undefined && r.tabelaPreco !== null && !filters.tabelasPreco.includes(r.tabelaPreco)) return false;
    if (filters.grupoIn && !filters.grupoIn.includes(r.grupo)) return false;
    const isB2B = r.tabelaPreco === "Tabela atacado" || (b2bNormSet?.has(r.norm) ?? false);
    if (canal === "b2b" && !isB2B) return false;
    if (canal === "b2c" && isB2B) return false;
    return true;
  }

  const porProdutoPrimeira = new Map<string, { clientes: Set<string>; unidades: number; receita: number }>();
  const porProdutoUnico = new Map<string, { clientes: Set<string>; unidades: number; receita: number }>();
  for (const r of firstRows) {
    if (!passaFiltro(r)) continue;
    const cur = porProdutoPrimeira.get(r.produto) ?? { clientes: new Set<string>(), unidades: 0, receita: 0 };
    cur.clientes.add(r.norm);
    cur.unidades += r.quantidade;
    cur.receita += r.valorTotalLiquido;
    porProdutoPrimeira.set(r.produto, cur);

    if ((pedidosByNorm.get(r.norm) ?? 0) === 1) {
      const curU = porProdutoUnico.get(r.produto) ?? { clientes: new Set<string>(), unidades: 0, receita: 0 };
      curU.clientes.add(r.norm);
      curU.unidades += r.quantidade;
      curU.receita += r.valorTotalLiquido;
      porProdutoUnico.set(r.produto, curU);
    }
  }

  function toSorted(map: Map<string, { clientes: Set<string>; unidades: number; receita: number }>): ProdutoEntradaItem[] {
    return [...map.entries()]
      .map(([produto, v]) => ({ produto, clientes: v.clientes.size, unidades: v.unidades, receita: v.receita }))
      .sort((a, b) => b.clientes - a.clientes)
      .slice(0, limit);
  }

  return {
    primeiraCompra: toSorted(porProdutoPrimeira),
    compradorUnico: toSorted(porProdutoUnico),
  };
}

export type ClienteFicha = {
  cliente: string;
  telefone: string | null;
  email: string | null;
  cpfCnpj: string | null;
  dataNascimento: Date | null;
  cidade: string | null;
  estado: string | null;
  receitaBruta: number;
  receitaLiquida: number;
  pedidos: number;
  pedidosLiquidos: number;
  pedidosB2B: number;
  pedidosB2C: number;
  ticketMedio: number;
  primeiraCompra: Date;
  primeiraCompraFonte: "dapic" | "site_antigo";
  ultimaCompra: Date;
  receitaB2B: number;
  receitaB2C: number;
  unidadesBrutas: number;
  unidadesLiquidas: number;
  comportamentoPreco: ClientePrecoBehavior;
  topGrupos: {
    grupo: string;
    unidadesBrutas: number;
    unidadesLiquidas: number;
    receitaBruta: number;
    receitaLiquida: number;
  }[];
  topProdutos: {
    produto: string;
    unidadesBrutas: number;
    unidadesLiquidas: number;
    receitaBruta: number;
    receitaLiquida: number;
  }[];
  topTamanhos: { tamanho: string; unidades: number }[];
  topLojas: { loja: string; pedidos: number; datas: Date[] }[];
  // bruta — devolução não é atribuída a mês aqui (só ao produto, ver comentário na função).
  historicoMensal: { month: string; receita: number; unidades: number }[];
};

// Ficha do cliente: histórico COMPLETO (não o período do filtro — uma ficha é um perfil, não um
// recorte), respeitando só loja/marca/tabela/grupo do filtro atual. Busca todas as variantes de
// capitalização do nome primeiro (raw SQL, único jeito de casar por nome normalizado no Prisma),
// depois usa elas num `in` normal — evita reescrever a query inteira em SQL cru.
export async function getClienteFicha(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "tabelasPreco" | "grupoIn">,
  busca: string
): Promise<ClienteFicha | null> {
  let norm = busca.trim().toUpperCase();
  if (!norm) return null;

  let variantRows = await prisma.$queryRaw<{ nome: string }[]>`
    SELECT DISTINCT "clienteNome" AS nome FROM "Sale" WHERE UPPER(TRIM("clienteNome")) = ${norm}
  `;
  // Se não achou por nome exato, tenta como CPF/CNPJ — compara só os dígitos (o cadastro guarda
  // formatado, ex: "098.286.597-00", o Rodrigo pode digitar com ou sem pontuação).
  if (variantRows.length === 0) {
    const somenteDigitos = busca.replace(/\D/g, "");
    if (somenteDigitos.length >= 8) {
      const cadastroPorCpf = await prisma.$queryRaw<{ nome: string }[]>`
        SELECT "nome" FROM "ClienteCadastro" WHERE regexp_replace("cpfCnpj", '[^0-9]', '', 'g') = ${somenteDigitos} LIMIT 1
      `;
      if (cadastroPorCpf.length > 0) {
        norm = cadastroPorCpf[0].nome.trim().toUpperCase();
        variantRows = await prisma.$queryRaw<{ nome: string }[]>`
          SELECT DISTINCT "clienteNome" AS nome FROM "Sale" WHERE UPPER(TRIM("clienteNome")) = ${norm}
        `;
      }
    }
  }
  if (variantRows.length === 0) return null;
  const variantes = variantRows.map((r) => r.nome);

  const allTime: DashboardFilters = {
    storeIds: filters.storeIds,
    marcas: filters.marcas,
    tabelasPreco: filters.tabelasPreco,
    grupoIn: filters.grupoIn,
    from: new Date(0),
    to: new Date(),
  };
  const where: Prisma.SaleWhereInput = { ...saleWhere(allTime), clienteNome: { in: variantes } };

  const [sales, cadastro, historicoLocal] = await Promise.all([
    prisma.sale.findMany({
      where,
      select: {
        saleDate: true, dapicVendaId: true, storeId: true, valorTotalLiquido: true,
        quantidade: true, tabelaPreco: true, produto: true, tamanho: true, grupo: true, cidade: true, estado: true,
        store: { select: { name: true, displayGroup: true } },
      },
    }),
    prisma.clienteCadastro.findMany({ where: { nome: { in: variantes } } }),
    // site antigo não tem "variantes" de nome pré-computadas (não é indexado por Sale) — casa
    // direto pelo mesmo conjunto de nomes normalizados já resolvido acima.
    prisma.vendaHistoricaExterna.findMany({
      where: { clienteNome: { in: variantes } },
      select: { saleDate: true, cidade: true, estado: true },
    }),
  ]);
  if (sales.length === 0) return null;

  // "De onde é" — pega o estado/cidade mais recente entre DAPIC e site antigo (não é endereço
  // fixo, é o que veio no pedido mais recente que tinha esse dado). Pedido do Rodrigo em
  // 2026-08-31.
  let estadoInfo: { cidade: string | null; estado: string; data: Date } | null = null;
  for (const s of sales) {
    if (s.estado && (!estadoInfo || s.saleDate > estadoInfo.data)) {
      estadoInfo = { cidade: s.cidade, estado: s.estado, data: s.saleDate };
    }
  }
  for (const h of historicoLocal) {
    if (h.estado && (!estadoInfo || h.saleDate > estadoInfo.data)) {
      estadoInfo = { cidade: h.cidade, estado: h.estado, data: h.saleDate };
    }
  }

  // Cliente é B2B se JÁ teve QUALQUER venda (não só nesse período/filtro, no histórico todo já
  // carregado em `sales`) batendo com "Tabela atacado" — mesma regra de canalWhere. Preço
  // negociado (comum em atacado) não bate com a tabela e vira tabelaPreco=null, que por linha
  // isolada pareceria B2C; aqui o cliente inteiro conta como B2B se algum dia bateu.
  const clienteEhB2B = sales.some((s) => s.tabelaPreco === "Tabela atacado");

  const pedidos = new Set<string>();
  // true = pelo menos 1 item do pedido é B2B (Tabela atacado) — pedido misto é raro, mas conta
  // como B2B se tiver qualquer item assim.
  const pedidoCanal = new Map<string, boolean>();
  let unidadesBrutas = 0, receitaBruta = 0, receitaB2B = 0, receitaB2C = 0;
  let primeiraCompra = sales[0].saleDate, ultimaCompra = sales[0].saleDate;
  let cheio = 0, promo = 0, comTabela = 0;
  const porProduto = new Map<string, { unidades: number; receita: number }>();
  const porGrupo = new Map<string, { unidades: number; receita: number }>();
  const porTamanho = new Map<string, number>();
  // Card resumido de "onde comprou" (agregado, não por produto) — pedido do Rodrigo em
  // 2026-08-28: a quebra por produto tinha sido tirada por ficar detalhada demais, mas ele quis
  // de volta um resumo geral de lojas.
  const porLoja = new Map<string, number>();
  const porMes = new Map<string, { receita: number; unidades: number }>();
  const pedidoKeys = new Set<string>();
  const storeIdToLoja = new Map<string, string>();
  // "Onde comprou" virou contagem de pedidos, não de peças (pedido do Rodrigo em 2026-08-28) —
  // pedido pertence a 1 loja só (mesmo storeId), então dá pra contar direto por pedidoKey.
  const pedidoKeyToLoja = new Map<string, string>();
  const pedidoUnidadesBruto = new Map<string, number>();
  // Data de cada pedido (todas as linhas de um mesmo pedido têm a mesma data) — pra listar
  // quando foi cada visita em "onde comprou". Pedido do Rodrigo em 2026-08-31.
  const pedidoKeyToData = new Map<string, Date>();

  for (const s of sales) {
    const pedidoKey = `${s.storeId}::${s.dapicVendaId}`;
    pedidos.add(pedidoKey);
    pedidoKeys.add(pedidoKey);
    pedidoUnidadesBruto.set(pedidoKey, (pedidoUnidadesBruto.get(pedidoKey) ?? 0) + s.quantidade);
    const isB2BLine = clienteEhB2B;
    pedidoCanal.set(pedidoKey, isB2BLine || (pedidoCanal.get(pedidoKey) ?? false));
    unidadesBrutas += s.quantidade;
    receitaBruta += s.valorTotalLiquido;
    if (isB2BLine) receitaB2B += s.valorTotalLiquido;
    else receitaB2C += s.valorTotalLiquido;
    if (s.saleDate < primeiraCompra) primeiraCompra = s.saleDate;
    if (s.saleDate > ultimaCompra) ultimaCompra = s.saleDate;
    if (s.tabelaPreco !== null) {
      comTabela++;
      if (TABELAS_PROMOCIONAIS.has(s.tabelaPreco)) promo += s.valorTotalLiquido;
      else if (TABELAS_CHEIAS.has(s.tabelaPreco)) cheio += s.valorTotalLiquido;
    }

    const p = porProduto.get(s.produto) ?? { unidades: 0, receita: 0 };
    p.unidades += s.quantidade;
    p.receita += s.valorTotalLiquido;
    porProduto.set(s.produto, p);

    const g = porGrupo.get(s.grupo) ?? { unidades: 0, receita: 0 };
    g.unidades += s.quantidade;
    g.receita += s.valorTotalLiquido;
    porGrupo.set(s.grupo, g);

    const tamanho = s.tamanho && s.tamanho.trim() ? s.tamanho : "—";
    porTamanho.set(tamanho, (porTamanho.get(tamanho) ?? 0) + s.quantidade);

    const loja = s.store.displayGroup ?? s.store.name;
    porLoja.set(loja, (porLoja.get(loja) ?? 0) + s.quantidade);
    storeIdToLoja.set(s.storeId, loja);
    pedidoKeyToLoja.set(pedidoKey, loja);
    pedidoKeyToData.set(pedidoKey, s.saleDate);

    const mes = s.saleDate.toISOString().slice(0, 7);
    const m = porMes.get(mes) ?? { receita: 0, unidades: 0 };
    m.receita += s.valorTotalLiquido;
    m.unidades += s.quantidade;
    porMes.set(mes, m);
  }

  let pedidosB2B = 0, pedidosB2C = 0;
  for (const isB2B of pedidoCanal.values()) {
    if (isB2B) pedidosB2B++;
    else pedidosB2C++;
  }

  // Devolução, por produto — Return não tem clienteNome, mas junta com os pedidos (storeId +
  // dapicVendaId) desse cliente que já buscamos acima. Return já tem seu próprio campo
  // "produto" (não precisa mais nada da Sale pra saber o quê foi devolvido), então dá pra netar
  // certo por produto, não só o total do cliente — antes "Produtos mais comprados" ficava bruto
  // mesmo com o resumo do topo mostrando líquida, número inconsistente na mesma tela.
  const storeIdsCliente = [...new Set(sales.map((s) => s.storeId))];
  const dapicVendaIdsCliente = [...new Set(sales.map((s) => s.dapicVendaId))];
  const returnsCliente = dapicVendaIdsCliente.length > 0
    ? await prisma.return.findMany({
        where: { storeId: { in: storeIdsCliente }, dapicVendaId: { in: dapicVendaIdsCliente } },
        select: { storeId: true, dapicVendaId: true, produto: true, tamanho: true, grupo: true, quantidade: true, valorTotal: true },
      })
    : [];
  const devolvidoPorProduto = new Map<string, { unidades: number; valor: number }>();
  const devolvidoPorGrupo = new Map<string, { unidades: number; valor: number }>();
  // Mesma netagem por produto, agora também por grupo, tamanho e loja — pedido do Rodrigo em
  // 2026-08-28: "onde comprou" e "tamanhos mais comprados" ficaram brutos enquanto o resto da
  // ficha já tinha virado líquido, inconsistente na mesma tela.
  const devolvidoPorTamanho = new Map<string, number>();
  const devolvidoPorLoja = new Map<string, number>();
  const pedidoUnidadesDevolvido = new Map<string, number>();
  let devolvidoUnidadesTotal = 0, devolvidoValorTotal = 0;
  for (const r of returnsCliente) {
    const pedidoKey = `${r.storeId}::${r.dapicVendaId}`;
    if (!pedidoKeys.has(pedidoKey)) continue;
    const cur = devolvidoPorProduto.get(r.produto) ?? { unidades: 0, valor: 0 };
    cur.unidades += r.quantidade;
    cur.valor += r.valorTotal;
    devolvidoPorProduto.set(r.produto, cur);

    const curGrupo = devolvidoPorGrupo.get(r.grupo) ?? { unidades: 0, valor: 0 };
    curGrupo.unidades += r.quantidade;
    curGrupo.valor += r.valorTotal;
    devolvidoPorGrupo.set(r.grupo, curGrupo);

    const tamanho = r.tamanho && r.tamanho.trim() ? r.tamanho : "—";
    devolvidoPorTamanho.set(tamanho, (devolvidoPorTamanho.get(tamanho) ?? 0) + r.quantidade);

    const loja = storeIdToLoja.get(r.storeId);
    if (loja) devolvidoPorLoja.set(loja, (devolvidoPorLoja.get(loja) ?? 0) + r.quantidade);

    pedidoUnidadesDevolvido.set(pedidoKey, (pedidoUnidadesDevolvido.get(pedidoKey) ?? 0) + r.quantidade);

    devolvidoUnidadesTotal += r.quantidade;
    devolvidoValorTotal += r.valorTotal;
  }

  // Pedido só conta como "líquido" (aqui e em "onde comprou") se sobrou saldo positivo depois da
  // devolução — pedido 100% devolvido não é um "pedido comprado" de verdade. KPI "Pedidos" no topo
  // usa isso como valor principal, com o bruto (pedidos.size) como subtexto — pedido do Rodrigo em
  // 2026-08-28, achou estranho o KPI bruto não bater com a soma de "onde comprou" (líquida).
  const pedidosPorLoja = new Map<string, number>();
  // Data de cada visita líquida por loja — pedido do Rodrigo em 2026-08-31, pra ver quando foi
  // cada vez que ele comprou em cada loja, não só a contagem.
  const datasPorLoja = new Map<string, Date[]>();
  let pedidosLiquidos = 0;
  for (const [pedidoKey, bruto] of pedidoUnidadesBruto) {
    const liquido = bruto - (pedidoUnidadesDevolvido.get(pedidoKey) ?? 0);
    if (liquido <= 0) continue;
    pedidosLiquidos++;
    const loja = pedidoKeyToLoja.get(pedidoKey);
    if (!loja) continue;
    pedidosPorLoja.set(loja, (pedidosPorLoja.get(loja) ?? 0) + 1);
    const data = pedidoKeyToData.get(pedidoKey);
    if (data) {
      const arr = datasPorLoja.get(loja) ?? [];
      arr.push(data);
      datasPorLoja.set(loja, arr);
    }
  }

  const cad = cadastro[0];
  // Nome de exibição: a variante de capitalização mais longa (heurística simples — geralmente é
  // a mais "completa", ex: prefere "João Tardim" a "JOAO TARDIM" só quando ambas tem o mesmo
  // tamanho não dá pra saber qual é a "certa" mesmo, mas na prática resolve a maioria dos casos).
  const nomeExibicao = [...variantes].sort((a, b) => b.length - a.length)[0] ?? busca;

  // Considera a 1ª compra pré-DAPIC (site antigo, ver getPrimeiraCompraGlobalPorCliente) também
  // na ficha — senão o card mostraria uma data mais recente que o real pra quem já era cliente
  // desde 2021-2023. Guarda a fonte pra mostrar um selo na tela (pedido do Rodrigo em 2026-08-31,
  // pra deixar visível que aquele dado veio do site antigo, já que a correção em si é invisível).
  let primeiraCompraFonte: "dapic" | "site_antigo" = "dapic";
  for (const c of cadastro) {
    if (c.primeiraCompraExterna && c.primeiraCompraExterna < primeiraCompra) {
      primeiraCompra = c.primeiraCompraExterna;
      primeiraCompraFonte = "site_antigo";
    }
  }

  return {
    cliente: nomeExibicao,
    telefone: cad?.telefone ?? cad?.celular ?? null,
    email: cad?.email ?? null,
    cpfCnpj: cad?.cpfCnpj ?? null,
    dataNascimento: cad?.dataNascimento ?? null,
    cidade: estadoInfo?.cidade ?? null,
    estado: estadoInfo?.estado ?? null,
    receitaBruta,
    receitaLiquida: receitaBruta - devolvidoValorTotal,
    unidadesBrutas,
    unidadesLiquidas: unidadesBrutas - devolvidoUnidadesTotal,
    pedidos: pedidos.size,
    pedidosLiquidos,
    pedidosB2B,
    pedidosB2C,
    // Líquido/líquido: receita líquida dividida por pedidos líquidos (pedido 100% devolvido não
    // deveria "puxar pra baixo" o ticket médio de quem ele nem chegou a ficar com nada).
    ticketMedio: pedidosLiquidos > 0 ? (receitaBruta - devolvidoValorTotal) / pedidosLiquidos : 0,
    primeiraCompra,
    primeiraCompraFonte,
    ultimaCompra,
    receitaB2B,
    receitaB2C,
    comportamentoPreco: classificarComportamentoPreco(cheio, promo, comTabela),
    topGrupos: [...porGrupo.entries()]
      .map(([grupo, v]) => {
        const dev = devolvidoPorGrupo.get(grupo) ?? { unidades: 0, valor: 0 };
        return {
          grupo,
          unidadesBrutas: v.unidades,
          unidadesLiquidas: v.unidades - dev.unidades,
          receitaBruta: v.receita,
          receitaLiquida: v.receita - dev.valor,
        };
      })
      .filter((g) => g.unidadesLiquidas !== 0)
      .sort((a, b) => b.receitaLiquida - a.receitaLiquida),
    topProdutos: [...porProduto.entries()]
      .map(([produto, v]) => {
        const dev = devolvidoPorProduto.get(produto) ?? { unidades: 0, valor: 0 };
        return {
          produto,
          unidadesBrutas: v.unidades,
          unidadesLiquidas: v.unidades - dev.unidades,
          receitaBruta: v.receita,
          receitaLiquida: v.receita - dev.valor,
        };
      })
      // 0 não conta como "comprado". Negativo fica visível de propósito (devolução > compra
      // naquele produto/loja/tamanho, normalmente troca feita em loja/registro diferente da
      // compra original) — sem clamp, a soma do card sempre bate com unidadesLiquidas do topo.
      .filter((p) => p.unidadesLiquidas !== 0)
      .sort((a, b) => b.receitaLiquida - a.receitaLiquida),
    topTamanhos: [...porTamanho.entries()]
      .map(([tamanho, unidades]) => ({ tamanho, unidades: unidades - (devolvidoPorTamanho.get(tamanho) ?? 0) }))
      .filter((t) => t.unidades !== 0)
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, 8),
    topLojas: [...porLoja.keys()]
      .map((loja) => ({
        loja,
        pedidos: pedidosPorLoja.get(loja) ?? 0,
        datas: (datasPorLoja.get(loja) ?? []).sort((a, b) => b.getTime() - a.getTime()),
      }))
      .filter((l) => l.pedidos !== 0)
      .sort((a, b) => b.pedidos - a.pedidos),
    historicoMensal: [...porMes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v })),
  };
}

// Aniversariantes de um mês específico (1-12), independente do ano de nascimento — pra
// campanha de aniversário. Segue os mesmos filtros da página (loja/marca/tabela de
// preço/vendedor/período) — só entra quem tem venda batendo com o filtro atual, mesma lista
// de clientes que já aparece em getTopClientes, só que sem o limite de 30 e sem ordenar por
// receita. Ordenado pelo dia do mês.
export async function getAniversariantesDoMes(filters: DashboardFilters, vendedor: string | null | undefined, month: number, canal: Canal = "todos") {
  const key = `aniversariantes:${vendedor ?? ""}:${month}:${canal}:${JSON.stringify({
    storeIds: filters.storeIds, marcas: filters.marcas, tabelasPreco: filters.tabelasPreco,
  })}`;
  return cacheAsync(key, HEAVY_QUERY_CACHE_MS, () => computeAniversariantesDoMes(filters, vendedor, month, canal));
}

// Usa o HISTÓRICO COMPLETO (ignora from/to do filtro) pra decidir QUEM entra na lista — mesmo
// motivo já documentado em getClienteSegmentacao: o período da tela (ex: últimos 30 dias) é
// current-period", não "cliente existe". Achado pelo Rodrigo em 2026-09-22: só 95 dos 500
// aniversariantes reais de setembro apareciam, porque o filtro padrão da tela (30 dias) exigia
// venda DENTRO desse período — os outros 405 são clientes reais do DAPIC que só não compraram
// recentemente, não "dado do site antigo" (esse aqui nunca usou VendaHistoricaExterna). Loja/
// marca/tabela/vendedor/canal continuam sendo respeitados normalmente, só data que vira all-time.
async function computeAniversariantesDoMes(filters: DashboardFilters, vendedor: string | null | undefined, month: number, canal: Canal) {
  const allTime: DashboardFilters = { ...filters, from: new Date(0), to: new Date() };
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(allTime),
    clienteNome: { not: null },
    ...(vendedor ? { vendedor } : {}),
    ...(canal !== "todos" ? { AND: [await canalWhere(canal)] } : {}),
  };
  const clientesFiltrados = await prisma.sale.groupBy({ by: ["clienteNome"], where });
  const nomes = clientesFiltrados.map((r) => r.clienteNome).filter((n): n is string => n !== null);
  if (nomes.length === 0) return [];

  const clientes = await prisma.clienteCadastro.findMany({
    where: { nome: { in: nomes }, dataNascimento: { not: null } },
  });
  return clientes
    .filter((c): c is typeof c & { dataNascimento: Date } => c.dataNascimento !== null && c.dataNascimento.getUTCMonth() + 1 === month)
    .sort((a, b) => a.dataNascimento.getUTCDate() - b.dataNascimento.getUTCDate());
}

export async function getClienteRetencaoPorMes(filters: DashboardFilters) {
  const siteAtacadoIds = await getSiteAtacadoStoreIds();
  if (siteAtacadoIds.length === 0) return { months: [], compraram1x: 0, compraramMaisde1x: 0 };
  const storeIds = filters.storeIds !== undefined ? siteAtacadoIds.filter((id) => filters.storeIds!.includes(id)) : siteAtacadoIds;
  if (storeIds.length === 0) return { months: [], compraram1x: 0, compraramMaisde1x: 0 };

  // Mesmo filtro de getAtacadoClientes — cliente já classificado como atacado (canalWhere("b2b")),
  // não só a linha bater com "Tabela atacado" — não mistura com o varejo do site que passa pela
  // mesma loja física.
  const b2bWhere = await canalWhere("b2b");
  const [salesInPeriod, allTimeFirst] = await Promise.all([
    prisma.sale.findMany({
      where: {
        ...saleWhere(filters),
        storeId: { in: storeIds },
        AND: [b2bWhere],
        clienteNome: { not: null },
      },
      select: { clienteNome: true, saleDate: true, dapicVendaId: true },
    }),
    prisma.sale.groupBy({
      by: ["clienteNome"],
      where: {
        ...saleWhere(filters),
        storeId: { in: storeIds },
        AND: [b2bWhere],
        clienteNome: { not: null },
        saleDate: { lte: filters.to },
      },
      _min: { saleDate: true },
    }),
  ]);

  const firstPurchaseMonth = new Map<string, string>();
  for (const r of allTimeFirst) {
    if (r.clienteNome && r._min.saleDate) {
      firstPurchaseMonth.set(r.clienteNome, r._min.saleDate.toISOString().slice(0, 7));
    }
  }

  // Cards: quantos clientes compraram exatamente 1x vs +1x no período
  const pedidosPorCliente = new Map<string, Set<number>>();
  for (const s of salesInPeriod) {
    if (!s.clienteNome) continue;
    const set = pedidosPorCliente.get(s.clienteNome) ?? new Set();
    set.add(s.dapicVendaId);
    pedidosPorCliente.set(s.clienteNome, set);
  }
  let compraram1x = 0;
  let compraramMaisde1x = 0;
  for (const [, pedidos] of pedidosPorCliente) {
    if (pedidos.size === 1) compraram1x++;
    else compraramMaisde1x++;
  }

  // Gráfico: clientes únicos por mês, separados em novos vs recorrentes
  const monthClientMap = new Map<string, Set<string>>();
  for (const s of salesInPeriod) {
    if (!s.clienteNome) continue;
    const monthKey = s.saleDate.toISOString().slice(0, 7);
    const set = monthClientMap.get(monthKey) ?? new Set();
    set.add(s.clienteNome);
    monthClientMap.set(monthKey, set);
  }

  const months = [...monthClientMap.entries()].sort().map(([month, clients]) => {
    let novos = 0;
    let recorrentes = 0;
    for (const cliente of clients) {
      const fp = firstPurchaseMonth.get(cliente);
      if (!fp || fp === month) novos++;
      else recorrentes++;
    }
    return { month, novos, recorrentes };
  });

  return { months, compraram1x, compraramMaisde1x };
}

// Versão varejo: mesma lógica mas usando saleWhere(filters) — respeita loja/marca/tabelaPreco
//
// Também inclui os pedidos do site antigo (VendaHistoricaExterna, vnda 2021-2025) — pedido do
// Rodrigo em 2026-08-31: depois de só corrigir a data de 1ª compra "por baixo dos panos" ele
// quis que aparecesse de verdade aqui. Só entra em cliente/pedido/data/valor — sem grupo/produto
// (não existe pra essas linhas), então nunca polui Vendas por Grupo/Produto/Tamanho nem
// Estoque×Vendas, que continuam só com dado do DAPIC. Chaves normalizadas (trim+upper) em tudo
// agora — precisa pra casar nome do vnda com nome do DAPIC (que também tem variação de
// capitalização entre si).
// vendedor opcional (2026-09-16) — mesmo motivo de getClientesCrmOverview. Não filtra o site
// antigo (vendaHistoricaExterna) por vendedor, mesma exceção já existente pra loja/marca/tabela/
// grupo — esse dado não tem vendedor atribuído.
export async function getClienteRetencaoVarejo(filters: DashboardFilters, vendedor?: string | null) {
  const baseWhere = saleWhere(filters);
  const norm = (n: string) => n.trim().toUpperCase();

  const [salesInPeriod, allTimeFirstSale, historicoInPeriod, historicoAllTimeFirst] = await Promise.all([
    prisma.sale.findMany({
      where: { ...baseWhere, clienteNome: { not: null }, ...(vendedor ? { vendedor } : {}) },
      select: { clienteNome: true, saleDate: true, dapicVendaId: true },
    }),
    prisma.sale.groupBy({
      by: ["clienteNome"],
      where: {
        clienteNome: { not: null },
        saleDate: { lte: filters.to },
        ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
        ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
        ...(filters.tabelasPreco !== undefined ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
        ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
        ...(vendedor ? { vendedor } : {}),
      },
      _min: { saleDate: true },
    }),
    // Site antigo não tem loja/marca/tabela/grupo — entra sempre, sem esses filtros.
    prisma.vendaHistoricaExterna.findMany({
      where: { saleDate: { gte: filters.from, lte: filters.to } },
      select: { clienteNome: true, saleDate: true, pedidoExterno: true },
    }),
    prisma.vendaHistoricaExterna.groupBy({
      by: ["clienteNome"],
      where: { saleDate: { lte: filters.to } },
      _min: { saleDate: true },
    }),
  ]);

  const firstPurchaseMonth = new Map<string, string>();
  function trackFirst(clienteNome: string, d: Date) {
    const k = norm(clienteNome);
    const m = d.toISOString().slice(0, 7);
    const cur = firstPurchaseMonth.get(k);
    if (!cur || m < cur) firstPurchaseMonth.set(k, m);
  }
  for (const r of allTimeFirstSale) if (r.clienteNome && r._min.saleDate) trackFirst(r.clienteNome, r._min.saleDate);
  for (const r of historicoAllTimeFirst) if (r._min.saleDate) trackFirst(r.clienteNome, r._min.saleDate);

  const pedidosPorCliente = new Map<string, Set<string>>();
  for (const s of salesInPeriod) {
    if (!s.clienteNome) continue;
    const k = norm(s.clienteNome);
    const set = pedidosPorCliente.get(k) ?? new Set<string>();
    set.add(String(s.dapicVendaId));
    pedidosPorCliente.set(k, set);
  }
  for (const h of historicoInPeriod) {
    const k = norm(h.clienteNome);
    const set = pedidosPorCliente.get(k) ?? new Set<string>();
    set.add(`vnda:${h.pedidoExterno}`);
    pedidosPorCliente.set(k, set);
  }
  let compraram1x = 0;
  let compraramMaisde1x = 0;
  for (const [, pedidos] of pedidosPorCliente) {
    if (pedidos.size === 1) compraram1x++;
    else compraramMaisde1x++;
  }

  const monthClientMap = new Map<string, Set<string>>();
  for (const s of salesInPeriod) {
    if (!s.clienteNome) continue;
    const monthKey = s.saleDate.toISOString().slice(0, 7);
    const set = monthClientMap.get(monthKey) ?? new Set<string>();
    set.add(norm(s.clienteNome));
    monthClientMap.set(monthKey, set);
  }
  for (const h of historicoInPeriod) {
    const monthKey = h.saleDate.toISOString().slice(0, 7);
    const set = monthClientMap.get(monthKey) ?? new Set<string>();
    set.add(norm(h.clienteNome));
    monthClientMap.set(monthKey, set);
  }

  const months = [...monthClientMap.entries()].sort().map(([month, clients]) => {
    let novos = 0;
    let recorrentes = 0;
    for (const cliente of clients) {
      const fp = firstPurchaseMonth.get(cliente);
      if (!fp || fp === month) novos++;
      else recorrentes++;
    }
    return { month, novos, recorrentes };
  });

  return { months, compraram1x, compraramMaisde1x };
}
