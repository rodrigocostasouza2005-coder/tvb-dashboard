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
  getPrimeiraVendaData,
  getNovosERecorrentesClientes,
  getTopClientes,
  getClienteTopMeses,
  getClientesCrmOverview,
  getClienteSegmentacao,
  getProdutosLiquidosPorClientes,
  getTamanhoEstoqueParaClientes,
  getClientesPrecoBehavior,
  getClientesPorDimensao,
  getCrossSellPorDimensao,
  getProdutosPortaDeEntrada,
  getClienteFicha,
  getAniversariantesDoMes,
  getClienteRetencaoPorMes,
  getClienteRetencaoVarejo,
  ClientesCrmOverview,
  ClienteSegmento,
  ClienteSegmentado,
  ClientePrecoBehavior,
  CrossSellResumo,
  CrossSellItem,
  CrossSellResult,
  ProdutoEntradaItem,
  ProdutosEntradaResult,
  ClienteFicha,
} from "./clientes";
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


export type SugestaoContato = {
  cliente: string;
  telefone: string | null;
  motivo: string;
  detalhe: string;
  produtoFavorito: string | null;
  loja: string | null;
  // Tamanho que o cliente mais compra do produtoFavorito, só preenchido quando ainda tem
  // disponível na loja principal dele agora — ver getTamanhoEstoqueParaClientes.
  tamanhoDisponivel: string | null;
  // Dono persistente do cliente (ver ClienteVendedorAtribuicao) — só preenchido quando dá pra
  // saber a loja exata (filtro de 1 loja só). vendedorOriginal só vem preenchido quando o
  // cliente foi redistribuído (o vendedor que tinha antes ficou inativo) — vira o selo
  // "Ex-cliente de X" na tela.
  vendedorAtual: string | null;
  vendedorOriginal: string | null;
};

// Vendedores ATIVOS de uma loja — pro dropdown de seleção em Sugestão de Contato (só quem ainda
// trabalha lá) e pra validar no backend que o vendedor escolhido pertence àquela loja E está
// ativo. Vendedor é entidade de verdade agora (ver model Vendedor, 2026-09-21) — antes disso
// só existia getVendedores(), que lê direto de Sale.vendedor sem noção de ativo/inativo.
export async function getVendedoresAtivos(storeId: string): Promise<string[]> {
  const rows = await prisma.vendedor.findMany({ where: { storeId, ativo: true }, orderBy: { nome: "asc" } });
  return rows.map((v) => v.nome);
}

// Garante que todo cliente da lista já tenha uma linha em ClienteVendedorAtribuicao — fallback
// de segurança (round-robin simples entre os vendedores ativos da loja) pro cliente que surgiu
// DEPOIS do backfill (scripts/backfill-vendedor-atribuicao.ts, que usa um critério melhor:
// ClienteCadastro.vendedorResponsavel, senão a venda mais recente do cliente). Não repete
// trabalho: só cria pra quem realmente ainda não tem.
async function garantirAtribuicoes(storeId: string, clientesNomes: string[]): Promise<void> {
  const norms = [...new Set(clientesNomes.map((n) => n.trim().toUpperCase()))];
  if (norms.length === 0) return;
  const existentes = await prisma.clienteVendedorAtribuicao.findMany({
    where: { storeId, clienteNorm: { in: norms } },
    select: { clienteNorm: true },
  });
  const jaTem = new Set(existentes.map((e) => e.clienteNorm));
  const faltando = norms.filter((n) => !jaTem.has(n));
  if (faltando.length === 0) return;

  const vendedoresAtivos = await prisma.vendedor.findMany({ where: { storeId, ativo: true }, orderBy: { nome: "asc" }, select: { id: true } });
  if (vendedoresAtivos.length === 0) return; // loja sem nenhum vendedor ativo — não dá pra atribuir

  const data = faltando.map((clienteNorm, i) => ({
    storeId,
    clienteNorm,
    vendedorAtualId: vendedoresAtivos[i % vendedoresAtivos.length].id,
  }));
  await prisma.clienteVendedorAtribuicao.createMany({ data, skipDuplicates: true });
}

export type AtribuicaoInfo = { vendedorAtual: string; vendedorOriginal: string | null };

// Cruza uma lista de clientes com quem é o "dono" atual deles numa loja específica — cria
// atribuição pra quem ainda não tinha (garantirAtribuicoes) antes de ler, pra nunca devolver
// vazio à toa. Batch (1 findMany, sem N+1) — chamado com a lista inteira de candidatos do dia,
// nunca 1 por cliente.
async function getAtribuicoesPorCliente(storeId: string, clientesNomes: string[]): Promise<Map<string, AtribuicaoInfo>> {
  await garantirAtribuicoes(storeId, clientesNomes);
  const norms = [...new Set(clientesNomes.map((n) => n.trim().toUpperCase()))];
  if (norms.length === 0) return new Map();
  const rows = await prisma.clienteVendedorAtribuicao.findMany({
    where: { storeId, clienteNorm: { in: norms } },
    include: { vendedorAtual: true, vendedorOriginal: true },
  });
  return new Map(
    rows.map((r) => [
      r.clienteNorm,
      { vendedorAtual: r.vendedorAtual.nome, vendedorOriginal: r.vendedorOriginal?.nome ?? null },
    ])
  );
}

// "Sugestões de Contato" — reformulado pelo Rodrigo em 2026-08-31 depois da 1ª versão: só B2C
// (isso aqui é atendimento de varejo, não relação com atacadista), mistura uma parte de CADA
// grupo (não deixa só VIP tomar a lista toda, como acontecia antes), mostra o produto favorito do
// cliente, muda todo dia (rotação, não sempre os mesmos), e separa por LOJA principal do cliente
// (não por pessoa — "cada loja tem seu próprio CRM", cada uma cuida dos seus próprios clientes).
//
// 6 grupos, cada um contribuindo até POR_GRUPO_POR_DIA:
// 1) VIP esfriando (70-90 dias sem comprar — ainda dá tempo de reter antes de "em risco" de
//    verdade, limiar já usado em getClienteSegmentacao).
// 2) Recorrente esfriando (mesmo critério).
// 3) Aniversariante do mês.
//
// Rotação diária: cada grupo tem um pool (todo mundo elegível), e a cada dia pega uma "fatia"
// diferente do pool (round-robin pelo dia do ano) — em vez de sempre os mesmos K primeiros, dá
// pra cobrir o pool inteiro ao longo de vários dias e ainda assim mudar toda vez que alguém abre
// a tela no mesmo dia.
const POR_GRUPO_POR_DIA = 6;

function diaDoAno(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

function fatiaDoDia<T>(pool: T[], porDia: number, seed: number): T[] {
  if (pool.length === 0) return [];
  const start = (seed * porDia) % pool.length;
  const out: T[] = [];
  for (let i = 0; i < Math.min(porDia, pool.length); i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

const ESFRIANDO_DIAS_MIN = 70;
const ESFRIANDO_DIAS_MAX = 90;

// vendedor opcional (2026-09-21, reescrito): NÃO filtra mais direto em Sale.vendedor (isso
// prendia o cliente pra sempre a quem baixou a última venda, sem jeito de redistribuir quando
// alguém sai da empresa). A geração dos 6 pools continua idêntica (segmentação/aniversariantes
// SEM filtro de vendedor, mesma lógica de sempre) — o filtro por vendedor agora é uma camada
// por cima, cruzando o resultado final com ClienteVendedorAtribuicao (dono persistente,
// redistribuível). Só é possível quando dá pra saber a loja exata (filters.storeIds com 1 loja
// só — é sempre o caso quando vem de um login de loja única, que é o único jeito de chegar
// nessa tela com um vendedor selecionado).
export async function getSugestoesDeContato(filters: DashboardFilters, vendedor?: string | null): Promise<SugestaoContato[]> {
  const storeIdUnico = filters.storeIds?.length === 1 ? filters.storeIds[0] : null;
  const mesAtual = new Date().getUTCMonth() + 1;
  const [segmentacao, aniversariantes] = await Promise.all([
    getClienteSegmentacao(filters, "b2c"),
    getAniversariantesDoMes(filters, null, mesAtual, "b2c"),
  ]);

  // Só quem tem telefone no cadastro — sem isso não dá pra chamar no WhatsApp, não faz sentido
  // ocupar uma vaga do dia com alguém incontatável. Pedido do Rodrigo em 2026-08-31.
  const vipPool = segmentacao
    .filter((s) => s.segmento === "vip" && s.telefone && s.recenciaDias >= ESFRIANDO_DIAS_MIN && s.recenciaDias <= ESFRIANDO_DIAS_MAX)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  const recorrentePool = segmentacao
    .filter((s) => s.segmento === "recorrente" && s.telefone && s.recenciaDias >= ESFRIANDO_DIAS_MIN && s.recenciaDias <= ESFRIANDO_DIAS_MAX)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  // 3 grupos a mais, pedido do Rodrigo em 2026-08-31 — esses já são "frios" pela própria definição
  // do segmento (em_risco/inativo já passaram do limiar de recência, ocasional nunca teve um 2º
  // pedido), então não precisam da janela extra de "esfriando" que VIP/Recorrente usam.
  const emRiscoPool = segmentacao
    .filter((s) => s.segmento === "em_risco" && s.telefone)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  const ocasionalPool = segmentacao
    .filter((s) => s.segmento === "ocasional" && s.telefone)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  const inativoPool = segmentacao
    .filter((s) => s.segmento === "inativo" && s.telefone)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  // Só o dia exato do aniversário — pedido do Rodrigo em 2026-08-31 (diferente da Visão Geral,
  // que mostra o mês inteiro de propósito, pra planejamento; aqui é "ligar hoje", só faz sentido
  // no dia certo).
  const hojeDia = new Date().getUTCDate();
  const aniversarioPool = aniversariantes
    .filter((a) => (a.telefone ?? a.celular) && a.dataNascimento.getUTCDate() === hojeDia)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // Loja principal de qualquer cliente (mesmo os que só apareceram via aniversariante, que vem
  // do ClienteCadastro sem essa info) — resolve pela Segmentação completa, que já cobre todo
  // mundo com compra registrada.
  const lojaPorNorm = new Map(segmentacao.map((s) => [s.cliente.trim().toUpperCase(), s.lojaPrincipal]));

  const seed = diaDoAno(new Date());
  const selecionados: Omit<SugestaoContato, "produtoFavorito" | "tamanhoDisponivel" | "vendedorAtual" | "vendedorOriginal">[] = [];
  for (const s of fatiaDoDia(vipPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "VIP esfriando", detalhe: `${s.recenciaDias} dias sem comprar`, loja: s.lojaPrincipal });
  }
  for (const s of fatiaDoDia(recorrentePool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "Recorrente esfriando", detalhe: `${s.recenciaDias} dias sem comprar`, loja: s.lojaPrincipal });
  }
  for (const s of fatiaDoDia(emRiscoPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "Em risco", detalhe: `${s.recenciaDias} dias sem comprar`, loja: s.lojaPrincipal });
  }
  for (const s of fatiaDoDia(ocasionalPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "Comprou só 1 vez", detalhe: `há ${s.recenciaDias} dias`, loja: s.lojaPrincipal });
  }
  for (const s of fatiaDoDia(inativoPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "Inativo", detalhe: `${s.recenciaDias} dias sem comprar`, loja: s.lojaPrincipal });
  }
  for (const a of fatiaDoDia(aniversarioPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({
      cliente: a.nome,
      telefone: a.telefone ?? a.celular,
      motivo: "Aniversário",
      detalhe: `Dia ${a.dataNascimento.getUTCDate().toString().padStart(2, "0")}`,
      loja: lojaPorNorm.get(a.nome.trim().toUpperCase()) ?? null,
    });
  }

  // Produto favorito — em lote (1 query pros clientes do dia, nunca 1 por linha).
  const produtosPorCliente = await getProdutosLiquidosPorClientes(filters, selecionados.map((s) => s.cliente));

  const comProdutoFavorito = selecionados.map((s) => ({
    ...s,
    produtoFavorito: produtosPorCliente.get(s.cliente.trim().toUpperCase())?.[0]?.produto ?? null,
  }));

  // Tamanho + disponibilidade em estoque — também em lote, só pra quem tem produto favorito.
  const tamanhoEstoquePorCliente = await getTamanhoEstoqueParaClientes(
    comProdutoFavorito
      .filter((s): s is typeof s & { produtoFavorito: string } => s.produtoFavorito !== null)
      .map((s) => ({ cliente: s.cliente, produto: s.produtoFavorito, loja: s.loja }))
  );

  const comTamanho = comProdutoFavorito.map((s) => {
    const info = tamanhoEstoquePorCliente.get(s.cliente.trim().toUpperCase());
    return { ...s, tamanhoDisponivel: info?.disponivel ? info.tamanho : null };
  });

  // Sem loja única definida (visão de admin/gestão com mais de 1 loja, ou nenhuma), não dá pra
  // saber em qual loja procurar a atribuição — comportamento igual a antes do vendedor existir.
  if (!storeIdUnico) {
    return comTamanho.map((s) => ({ ...s, vendedorAtual: null, vendedorOriginal: null }));
  }

  const atribuicoes = await getAtribuicoesPorCliente(storeIdUnico, comTamanho.map((s) => s.cliente));
  const comVendedor = comTamanho.map((s) => {
    const info = atribuicoes.get(s.cliente.trim().toUpperCase());
    return { ...s, vendedorAtual: info?.vendedorAtual ?? null, vendedorOriginal: info?.vendedorOriginal ?? null };
  });
  return vendedor ? comVendedor.filter((s) => s.vendedorAtual === vendedor) : comVendedor;
}

export type FollowUpPosCompra = {
  cliente: string;
  telefone: string | null;
  produtos: string[];
  diasAtras: number;
  loja: string | null;
  // Venda mais recente do cliente na janela — usado pra buscar o número da nota/cupom fiscal
  // ao vivo no DAPIC (ver getNumeroNotaFiscal em connectors/nota-fiscal.ts), sob demanda, não
  // gravado no banco.
  storeId: string;
  dapicVendaId: number;
  // Código HUMANO dessa venda específica (Sale.codigo) — pedido do Rodrigo em 2026-09-21, pro
  // template de follow-up mostrar o código real da venda que gerou aquele follow-up (nunca a
  // última venda do cliente em geral). Null pra vendas sincronizadas antes desse campo existir.
  codigo: string | null;
  vendedorAtual: string | null;
  vendedorOriginal: string | null;
};

// Follow-up pós-compra — pedido do Rodrigo em 2026-08-31: clientes que compraram há 7-10 dias,
// pra perguntar se gostou/conseguiu aproveitar o produto. Só B2C (mesma lógica da aba inteira).
// Não precisa de rotação artificial — a janela de 7-10 dias já muda sozinha todo dia conforme o
// tempo passa (quem cai nela hoje sai amanhã).
const FOLLOWUP_DIAS_MIN = 7;
const FOLLOWUP_DIAS_MAX = 10;

// vendedor opcional (2026-09-21, reescrito) — mesmo motivo/padrão de getSugestoesDeContato: não
// filtra mais direto em Sale.vendedor, cruza com ClienteVendedorAtribuicao depois.
export async function getFollowUpPosCompra(filters: DashboardFilters, vendedor?: string | null): Promise<FollowUpPosCompra[]> {
  const storeIdUnico = filters.storeIds?.length === 1 ? filters.storeIds[0] : null;
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - FOLLOWUP_DIAS_MAX * 86400000);
  const fim = new Date(hoje.getTime() - FOLLOWUP_DIAS_MIN * 86400000);
  const where: Prisma.SaleWhereInput = {
    ...saleWhere({ ...filters, from: inicio, to: fim }),
    clienteNome: { not: null },
    AND: [await canalWhere("b2c")],
  };
  const rows = await prisma.sale.findMany({
    where,
    select: {
      clienteNome: true,
      saleDate: true,
      produto: true,
      storeId: true,
      dapicVendaId: true,
      codigo: true,
      store: { select: { name: true, displayGroup: true } },
    },
  });
  if (rows.length === 0) return [];

  const porCliente = new Map<
    string,
    { nome: string; produtos: Set<string>; data: Date; loja: string; storeId: string; dapicVendaId: number; codigo: string | null }
  >();
  for (const r of rows) {
    const nome = r.clienteNome as string;
    const norm = nome.trim().toUpperCase();
    const loja = r.store.displayGroup ?? r.store.name;
    const cur =
      porCliente.get(norm) ??
      { nome, produtos: new Set<string>(), data: r.saleDate, loja, storeId: r.storeId, dapicVendaId: r.dapicVendaId, codigo: r.codigo };
    cur.produtos.add(r.produto);
    // Loja/venda da compra mais recente dentro da janela — se comprou em 2 lojas na mesma
    // janela (raro), fica a da compra mais nova (é dessa venda que sai o número da nota e o
    // código exibido — sempre da venda específica que originou o follow-up, nunca de outra).
    if (r.saleDate > cur.data) { cur.data = r.saleDate; cur.loja = loja; cur.storeId = r.storeId; cur.dapicVendaId = r.dapicVendaId; cur.codigo = r.codigo; }
    porCliente.set(norm, cur);
  }

  const nomes = [...porCliente.values()].map((c) => c.nome);
  const cadastros = await prisma.clienteCadastro.findMany({ where: { nome: { in: nomes } } });
  const cadastroByNome = new Map(cadastros.map((c) => [c.nome, c]));

  const now = new Date();
  const base = [...porCliente.values()]
    .map((c) => {
      const cad = cadastroByNome.get(c.nome);
      return {
        cliente: c.nome,
        telefone: cad?.telefone ?? cad?.celular ?? null,
        produtos: [...c.produtos],
        diasAtras: Math.floor((now.getTime() - c.data.getTime()) / 86400000),
        loja: c.loja,
        storeId: c.storeId,
        dapicVendaId: c.dapicVendaId,
        codigo: c.codigo,
      };
    })
    // Sem telefone não dá pra chamar no WhatsApp — mesmo critério de getSugestoesDeContato.
    .filter((f) => f.telefone !== null)
    .sort((a, b) => a.diasAtras - b.diasAtras);

  if (!storeIdUnico) {
    return base.map((f) => ({ ...f, vendedorAtual: null, vendedorOriginal: null }));
  }
  const atribuicoes = await getAtribuicoesPorCliente(storeIdUnico, base.map((f) => f.cliente));
  const comVendedor = base.map((f) => {
    const info = atribuicoes.get(f.cliente.trim().toUpperCase());
    return { ...f, vendedorAtual: info?.vendedorAtual ?? null, vendedorOriginal: info?.vendedorOriginal ?? null };
  });
  return vendedor ? comVendedor.filter((f) => f.vendedorAtual === vendedor) : comVendedor;
}

export type ContatoRealizado = {
  cliente: string;
  tipo: "sugestao" | "followup";
  chave: string;
  contatadoPor: string;
  contatadoEm: Date;
};

export type ContatoPorVendedor = { vendedor: string; sugestoes: number; followUps: number; total: number };

// "Contatos por Vendedor" — ranking de quem marcou mais contatos na aba Sugestões de Contato
// (ver ContatoMarcado no schema e contato-whatsapp-link.tsx), pedido do Rodrigo em 2026-09-09
// logo depois de pedir o check em si ("como cada login tá se saindo nas mensagens"). Marcação é
// só "clicou no link do WhatsApp", não confirmação de entrega de verdade.
//
// allowedStoreIds = getStoreRestriction(user) de quem tá vendo essa tela. Achado pelo Rodrigo em
// 2026-09-22: login de loja única (ex: Leblon) via contato de TODAS as lojas aqui, porque essa
// função nunca filtrava por loja. Só filtra quando é loja única de verdade (allowedStoreIds.length
// === 1, mesmo sinal usado em resolverContatadoPor/getVendedoresAtivos) — login multi-loja
// (admin/gestão/atendimento) continua vendo tudo, igual sempre viu. Registro sem storeId
// (contato marcado por login multi-loja, ou registro antigo de antes dessa coluna existir) não
// aparece pra visão de loja única, já que não dá pra confirmar de qual loja é.
export async function getContatosPorVendedor(from: Date, to: Date, allowedStoreIds?: string[]): Promise<{ ranking: ContatoPorVendedor[]; itens: ContatoRealizado[] }> {
  const storeIdLojaUnica = allowedStoreIds?.length === 1 ? allowedStoreIds[0] : null;
  const rows = await prisma.contatoMarcado.findMany({
    where: {
      contatadoEm: { gte: from, lte: to },
      ...(storeIdLojaUnica ? { storeId: storeIdLojaUnica } : {}),
    },
    orderBy: { contatadoEm: "desc" },
  });

  const porVendedor = new Map<string, ContatoPorVendedor>();
  for (const r of rows) {
    const cur = porVendedor.get(r.contatadoPor) ?? { vendedor: r.contatadoPor, sugestoes: 0, followUps: 0, total: 0 };
    if (r.tipo === "sugestao") cur.sugestoes += 1;
    else cur.followUps += 1;
    cur.total += 1;
    porVendedor.set(r.contatadoPor, cur);
  }

  return {
    ranking: [...porVendedor.values()].sort((a, b) => b.total - a.total),
    itens: rows.map((r) => ({
      cliente: r.cliente,
      tipo: r.tipo as "sugestao" | "followup",
      chave: r.chave,
      contatadoPor: r.contatadoPor,
      contatadoEm: r.contatadoEm,
    })),
  };
}

export async function getVendedores(allowedStoreIds?: string[]): Promise<string[]> {
  const rows = await prisma.sale.findMany({
    distinct: ["vendedor"],
    select: { vendedor: true },
    where: { vendedor: { not: null }, ...(allowedStoreIds !== undefined ? { storeId: { in: allowedStoreIds } } : {}) },
  });
  return rows.map((r) => r.vendedor as string).sort();
}
