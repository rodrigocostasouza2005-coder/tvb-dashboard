import { prisma } from "@/lib/prisma";
import { Prisma, TipoCompraProduto, StatusComercialProduto, PossibilidadeReposicao } from "@prisma/client";

// ---------------------------------------------------------------------------
// MOTOR DE CÁLCULO — BEST SELLER vs DROP
// ---------------------------------------------------------------------------
// Pedido do Rodrigo em 2026-10-27 ("EVOLUÇÃO DO RADAR — INTELIGÊNCIA DE COMPRAS BEST SELLER E
// DROPS"): separar reposição recorrente (Best Seller) de coleção limitada (Drop), com
// recomendação de quanto comprar, explicável (sem score misterioso) e sem executar nada sozinho
// — só sugere, quem decide é humano (ver registrarDecisaoCompra).
//
// Este arquivo tem DUAS camadas:
// 1) Funções PURAS (calcularSugestaoBestSeller, calcularSugestaoDrop, priorizarOrcamentoCompras)
//    — sem Prisma, só matemática sobre os inputs recebidos. São o que os testes em
//    __tests__/comprasInteligencia.test.ts cobrem cenário a cenário.
// 2) Funções de DADO (getFilaRevisaoClassificacao, upsertClassificacaoProduto, etc.) — montam o
//    input real a partir de Sale/StockSnapshot/ProductionOrder/ClassificacaoProduto e chamam as
//    funções puras. Não têm teste unitário nesta entrega (precisariam de banco ou um mock extenso
//    de agregações Prisma) — ver relatório final, item 6.

const MIN_DIAS_HISTORICO_CONFIAVEL = 14;
// Estoque acima disso em relação à previsão de venda até o fim da janela do Drop = risco de
// sobra (seção 5: "risco de sobra de estoque"). 20% de margem antes de soar o alerta — evita
// marcar como "risco" uma folga pequena e normal de operação.
const MARGEM_RISCO_SOBRA_DROP = 1.2;

export type RecebimentoPrevisto = {
  quantidade: number;
  dataPrevista: Date | null;
  // false = não existe data confiável de recebimento (ex: ProductionOrder sem
  // dataFinalizacaoProducao) — a quantidade existe mas não entra na conta como "utilizável"
  // dentro do horizonte, só é citada nas premissas. Pedido do Rodrigo, seção 11: "Pedido em
  // aberto sem data confiável de recebimento" é cenário de teste explícito.
  confiavel: boolean;
  origem?: string;
};

export type InputBestSeller = {
  cod?: string;
  grupo: string;
  horizonteCoberturaDias: number;
  vendaMediaDiaria: number;
  diasHistoricoDisponivel: number;
  estoqueDisponivel: number;
  estoqueComprometido?: number;
  estoqueSegurancaUnidades?: number | null;
  leadTimeDias?: number | null;
  recebimentosPrevistos?: RecebimentoPrevisto[];
  sazonalidadeFator?: number | null;
  custoUnitario?: number | null;
};

export type SugestaoBestSeller = {
  cod?: string;
  grupo: string;
  estoqueDisponivelUtilizavel: number;
  demandaProjetadaHorizonte: number;
  coberturaAtualDias: number | null;
  recebimentosUtilizaveis: number;
  quantidadeSugerida: number;
  valorEstimado: number | null;
  confiavel: boolean;
  premissas: string[];
  avisos: string[];
};

// Fórmula-base do pedido (seção 4): compra sugerida = max(0, demanda projetada no horizonte +
// estoque de segurança − estoque disponível utilizável − recebimentos previstos utilizáveis).
// Adaptada aqui pra: (a) incluir a demanda do próprio lead time dentro do horizonte quando o
// prazo de entrega é conhecido (senão a cobertura fica sem o período "cego" entre pedir e
// receber); (b) nunca contar recebimento sem data confiável como "utilizável" (dupla-conta
// evitada: ou é recebimento previsto confiável, ou é só um aviso de que existe produção em
// aberto sem previsão).
export function calcularSugestaoBestSeller(input: InputBestSeller): SugestaoBestSeller {
  const premissas: string[] = [];
  const avisos: string[] = [];

  const estoqueComprometido = input.estoqueComprometido ?? 0;
  const estoqueDisponivelUtilizavel = Math.max(input.estoqueDisponivel - estoqueComprometido, 0);
  if (estoqueComprometido > 0) {
    premissas.push(
      `Estoque comprometido (${estoqueComprometido} un) descontado do disponível antes de calcular a sugestão.`
    );
  }

  const leadTimeDias = input.leadTimeDias ?? 0;
  if (!input.leadTimeDias) {
    avisos.push("Prazo de entrega do fornecedor não cadastrado para este grupo — horizonte considera só a cobertura desejada, sem o período de reposição.");
  }
  const horizonteTotalDias = input.horizonteCoberturaDias + leadTimeDias;

  const sazonalidadeFator = input.sazonalidadeFator ?? 1;
  if (input.sazonalidadeFator == null) {
    premissas.push("Sem fator de sazonalidade informado — assumido 1 (sem ajuste).");
  }

  const demandaProjetadaHorizonte = input.vendaMediaDiaria * sazonalidadeFator * horizonteTotalDias;

  const estoqueSeguranca = input.estoqueSegurancaUnidades ?? 0;
  if (input.estoqueSegurancaUnidades == null) {
    avisos.push("Estoque de segurança não cadastrado para este grupo — assumido 0 (sugestão pode ficar justa demais).");
  }

  let recebimentosUtilizaveis = 0;
  const recebimentos = input.recebimentosPrevistos ?? [];
  const fimHorizonte = new Date(Date.now() + horizonteTotalDias * 86_400_000);
  for (const r of recebimentos) {
    if (!r.confiavel || !r.dataPrevista) {
      avisos.push(
        `Pedido em aberto de ${r.quantidade} un${r.origem ? ` (${r.origem})` : ""} sem data de recebimento confiável — NÃO contado como disponível, só sinalizado.`
      );
      continue;
    }
    if (r.dataPrevista.getTime() <= fimHorizonte.getTime()) {
      recebimentosUtilizaveis += r.quantidade;
    } else {
      avisos.push(`Recebimento de ${r.quantidade} un previsto para depois do horizonte considerado — não contado nesta sugestão.`);
    }
  }

  const diasHistoricoDisponivel = input.diasHistoricoDisponivel;
  const semHistoricoSuficiente = diasHistoricoDisponivel < MIN_DIAS_HISTORICO_CONFIAVEL;
  const semGiroESemEstoque = input.vendaMediaDiaria === 0 && estoqueDisponivelUtilizavel === 0;
  if (semHistoricoSuficiente) {
    avisos.push(
      `Só ${diasHistoricoDisponivel} dia(s) de histórico de venda disponível (mínimo recomendado: ${MIN_DIAS_HISTORICO_CONFIAVEL}) — recomendação de baixa confiança.`
    );
  }
  if (semGiroESemEstoque) {
    avisos.push("Sem venda e sem estoque registrados — não há dado suficiente para sustentar uma recomendação.");
  }
  const confiavel = !semHistoricoSuficiente && !semGiroESemEstoque;

  const sugestaoBruta = demandaProjetadaHorizonte + estoqueSeguranca - estoqueDisponivelUtilizavel - recebimentosUtilizaveis;
  const quantidadeSugerida = confiavel ? Math.max(0, Math.round(sugestaoBruta)) : 0;
  if (!confiavel) {
    avisos.push("Quantidade sugerida zerada por falta de dado confiável — não interpretar como \"não precisa comprar\", é \"não dá para calcular com segurança\".");
  }

  const coberturaAtualDias = input.vendaMediaDiaria > 0 ? estoqueDisponivelUtilizavel / input.vendaMediaDiaria : null;
  const valorEstimado = input.custoUnitario != null ? quantidadeSugerida * input.custoUnitario : null;

  return {
    cod: input.cod,
    grupo: input.grupo,
    estoqueDisponivelUtilizavel,
    demandaProjetadaHorizonte,
    coberturaAtualDias,
    recebimentosUtilizaveis,
    quantidadeSugerida,
    valorEstimado,
    confiavel,
    premissas,
    avisos,
  };
}

export type InputDrop = {
  cod?: string;
  colecao: string;
  grupo: string;
  possibilidadeReposicao: PossibilidadeReposicao;
  quantidadeCompradaOriginal: number;
  estoqueDisponivel: number;
  vendasAcumuladas: number;
  velocidadeVendaDiaria: number;
  diasDesdeLancamento: number | null;
  diasRestantesJanela: number;
  custoUnitario?: number | null;
  precoUnitario?: number | null;
  orcamentoDisponivelDrop?: number | null;
  pedidosEmAberto?: RecebimentoPrevisto[];
};

export type SugestaoDrop = {
  cod?: string;
  colecao: string;
  grupo: string;
  sellThroughAtual: number | null;
  previsaoVendaAteFimJanela: number;
  riscoSobra: boolean;
  excedenteEstimado: number;
  riscoRuptura: boolean;
  faltanteEstimado: number;
  quantidadeSugerida: number | null;
  valorEstimado: number | null;
  bloqueadoRecompra: boolean;
  precisaConfirmacaoHumana: boolean;
  premissas: string[];
  avisos: string[];
};

// Lógica separada da de Best Seller (seção 5 do pedido): NUNCA recompra automática. Se
// possibilidadeReposicao = NAO, bloqueia qualquer sugestão de quantidade adicional (só reporta
// risco de sobra/ruptura do estoque já existente). Se = A_CONFIRMAR, calcula o risco mas marca
// que precisa de confirmação humana antes de sugerir número. Só com SIM a função devolve uma
// quantidade sugerida de fato — e mesmo assim, limitada à janela comercial restante, nunca um
// reabastecimento "pra sempre" como Best Seller.
export function calcularSugestaoDrop(input: InputDrop): SugestaoDrop {
  const premissas: string[] = [];
  const avisos: string[] = [];

  const semHistoricoDeVenda = input.diasDesdeLancamento == null || input.diasDesdeLancamento <= 0;
  if (semHistoricoDeVenda) {
    avisos.push("Drop sem histórico de venda (ainda não lançado ou lançado há 0 dias) — sell-through e previsão não são calculáveis a partir de venda; use apenas para decisão de compra/produção inicial.");
  }

  const sellThroughAtual =
    input.quantidadeCompradaOriginal > 0 ? (input.vendasAcumuladas / input.quantidadeCompradaOriginal) * 100 : null;
  if (input.quantidadeCompradaOriginal === 0) {
    premissas.push("Sem quantidade comprada/produzida original cadastrada — sell-through não calculado.");
  }

  const previsaoVendaAteFimJanela = Math.max(input.velocidadeVendaDiaria * input.diasRestantesJanela, 0);
  premissas.push(
    `Previsão linear: velocidade de venda atual (${input.velocidadeVendaDiaria.toFixed(2)} un/dia) × dias restantes de janela (${input.diasRestantesJanela}) — não considera desaceleração natural de fim de coleção.`
  );

  const riscoSobra = input.estoqueDisponivel > previsaoVendaAteFimJanela * MARGEM_RISCO_SOBRA_DROP;
  const excedenteEstimado = riscoSobra ? Math.round(input.estoqueDisponivel - previsaoVendaAteFimJanela) : 0;

  const riscoRuptura = previsaoVendaAteFimJanela > input.estoqueDisponivel;
  const faltanteEstimado = riscoRuptura ? Math.round(previsaoVendaAteFimJanela - input.estoqueDisponivel) : 0;

  let pedidosAbertoUtilizaveis = 0;
  for (const r of input.pedidosEmAberto ?? []) {
    if (r.confiavel) pedidosAbertoUtilizaveis += r.quantidade;
    else avisos.push(`Pedido em aberto de ${r.quantidade} un sem data confiável de recebimento — não contado na cobertura da janela.`);
  }

  let quantidadeSugerida: number | null = null;
  let bloqueadoRecompra = false;
  let precisaConfirmacaoHumana = false;

  if (input.possibilidadeReposicao === PossibilidadeReposicao.NAO) {
    bloqueadoRecompra = true;
    quantidadeSugerida = 0;
    avisos.push("Reposição marcada como NÃO permitida para este Drop — recomendação automática de recompra bloqueada. Risco de ruptura/sobra abaixo é só informativo.");
  } else if (input.possibilidadeReposicao === PossibilidadeReposicao.A_CONFIRMAR) {
    precisaConfirmacaoHumana = true;
    quantidadeSugerida = null;
    avisos.push("Possibilidade de reposição ainda não confirmada — nenhuma quantidade é sugerida até confirmação humana.");
  } else {
    if (semHistoricoDeVenda) {
      // Compra/produção inicial (seção 5, pergunta 1: "Quanto comprar inicialmente?") — sem
      // venda pra basear, só dá pra sugerir algo se houver orçamento e custo cadastrados; senão
      // fica em aberto e marcado como decisão humana.
      if (input.orcamentoDisponivelDrop != null && input.custoUnitario != null && input.custoUnitario > 0) {
        quantidadeSugerida = Math.max(0, Math.floor(input.orcamentoDisponivelDrop / input.custoUnitario));
        avisos.push("Quantidade inicial baseada apenas no orçamento disponível ÷ custo unitário (sem dado de demanda) — recomenda-se confirmação humana antes de produzir.");
      } else {
        quantidadeSugerida = null;
        precisaConfirmacaoHumana = true;
        avisos.push("Sem orçamento/custo unitário cadastrados para estimar quantidade inicial — decisão totalmente humana.");
      }
    } else {
      quantidadeSugerida = Math.max(0, faltanteEstimado - pedidosAbertoUtilizaveis);
      if (input.orcamentoDisponivelDrop != null && input.custoUnitario != null && input.custoUnitario > 0) {
        const tetoPorOrcamento = Math.floor(input.orcamentoDisponivelDrop / input.custoUnitario);
        if (quantidadeSugerida > tetoPorOrcamento) {
          avisos.push(`Quantidade sugerida (${quantidadeSugerida}) excede o teto de orçamento do Drop (${tetoPorOrcamento} un) — reduzida ao teto.`);
          quantidadeSugerida = tetoPorOrcamento;
        }
      }
    }
  }

  const valorEstimado =
    quantidadeSugerida != null && input.custoUnitario != null ? quantidadeSugerida * input.custoUnitario : null;

  return {
    cod: input.cod,
    colecao: input.colecao,
    grupo: input.grupo,
    sellThroughAtual,
    previsaoVendaAteFimJanela,
    riscoSobra,
    excedenteEstimado,
    riscoRuptura,
    faltanteEstimado,
    quantidadeSugerida,
    valorEstimado,
    bloqueadoRecompra,
    precisaConfirmacaoHumana,
    premissas,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// VISÃO CONSOLIDADA E PRIORIZAÇÃO DE ORÇAMENTO (seção 7 do pedido)
// ---------------------------------------------------------------------------

export type ItemPriorizavel = {
  id: string;
  tipoCompra: TipoCompraProduto;
  grupo: string;
  quantidadeSugerida: number;
  valorEstimado: number;
  riscoRuptura: boolean;
  demandaComprovada: boolean;
  impactoComercial: number;
  diasRestantesJanela?: number | null;
};

export type ItemPriorizado = ItemPriorizavel & {
  prioridade: number;
  fatoresPrioridade: string[];
  atendido: boolean;
  motivoNaoAtendido: string | null;
};

// Quando orçamento disponível < necessidade total, PRIORIZA em vez de cortar tudo
// proporcionalmente (pedido explícito, seção 7) — Best Seller prioriza risco de ruptura primeiro,
// depois demanda comprovada por impacto comercial; Drop prioriza risco de ruptura dentro da
// janela primeiro, depois urgência (menos dias restantes = mais prioridade). Cada item carrega
// os FATORES usados (texto), não uma pontuação opaca.
export function priorizarOrcamentoCompras(
  itens: ItemPriorizavel[],
  orcamentoDisponivel: number | null
): ItemPriorizado[] {
  function tier(item: ItemPriorizavel): number {
    if (item.tipoCompra === TipoCompraProduto.BEST_SELLER) {
      if (item.riscoRuptura) return 0;
      if (item.demandaComprovada) return 1;
      return 2;
    }
    // DROP
    if (item.riscoRuptura) return 0;
    return 1;
  }

  function fatores(item: ItemPriorizavel): string[] {
    const f: string[] = [];
    if (item.tipoCompra === TipoCompraProduto.BEST_SELLER) {
      f.push(item.riscoRuptura ? "Risco de ruptura (prioridade máxima)" : "Sem risco de ruptura iminente");
      f.push(item.demandaComprovada ? "Demanda comprovada por histórico" : "Demanda ainda não comprovada por histórico suficiente");
      f.push(`Impacto comercial estimado: R$ ${item.impactoComercial.toFixed(2)}`);
    } else {
      f.push(item.riscoRuptura ? "Risco de ruptura dentro da janela comercial (prioridade máxima)" : "Sem risco de ruptura dentro da janela");
      if (item.diasRestantesJanela != null) f.push(`${item.diasRestantesJanela} dia(s) restantes de janela comercial`);
      f.push(`Impacto comercial estimado: R$ ${item.impactoComercial.toFixed(2)}`);
    }
    return f;
  }

  const ordenados = [...itens].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    if (a.tipoCompra === TipoCompraProduto.DROP && b.tipoCompra === TipoCompraProduto.DROP) {
      const da = a.diasRestantesJanela ?? Infinity;
      const db = b.diasRestantesJanela ?? Infinity;
      if (da !== db) return da - db;
    }
    return b.impactoComercial - a.impactoComercial;
  });

  let saldo = orcamentoDisponivel ?? Infinity;
  return ordenados.map((item, idx) => {
    const cabe = item.valorEstimado <= saldo;
    if (cabe) saldo -= item.valorEstimado;
    return {
      ...item,
      prioridade: idx + 1,
      fatoresPrioridade: fatores(item),
      atendido: cabe,
      motivoNaoAtendido: cabe
        ? null
        : orcamentoDisponivel == null
          ? null
          : `Orçamento disponível insuficiente neste ponto da priorização (faltariam R$ ${(item.valorEstimado - saldo).toFixed(2)}).`,
    };
  });
}

// ---------------------------------------------------------------------------
// CAMADA DE DADOS — classificação (cadastro, fila de revisão, histórico)
// ---------------------------------------------------------------------------

export type ClassificacaoInput = {
  cod: string;
  produto: string;
  grupo: string;
  colecao?: string | null;
  tipoCompra: TipoCompraProduto;
  statusComercial: StatusComercialProduto;
  possibilidadeReposicao: PossibilidadeReposicao;
  dataLancamento?: Date | null;
  dataEncerramentoPrevista?: Date | null;
  orcamentoDrop?: number | null;
  observacoes?: string | null;
};

const CAMPOS_HISTORICO: (keyof ClassificacaoInput)[] = [
  "produto",
  "grupo",
  "colecao",
  "tipoCompra",
  "statusComercial",
  "possibilidadeReposicao",
  "dataLancamento",
  "dataEncerramentoPrevista",
  "orcamentoDrop",
  "observacoes",
];

function valorParaHistorico(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// Cria ou atualiza a classificação de um produto, registrando em ClassificacaoProdutoHistorico
// só os campos que de fato mudaram (seção 2: "histórico de alterações quando viável") — inclui a
// reclassificação Drop↔Best Seller, cenário de teste explícito (seção 11).
export async function upsertClassificacaoProduto(input: ClassificacaoInput, alteradoPor?: string) {
  const existente = await prisma.classificacaoProduto.findUnique({ where: { cod: input.cod } });

  const salvo = await prisma.classificacaoProduto.upsert({
    where: { cod: input.cod },
    create: {
      cod: input.cod,
      produto: input.produto,
      grupo: input.grupo,
      colecao: input.colecao ?? null,
      tipoCompra: input.tipoCompra,
      statusComercial: input.statusComercial,
      possibilidadeReposicao: input.possibilidadeReposicao,
      dataLancamento: input.dataLancamento ?? null,
      dataEncerramentoPrevista: input.dataEncerramentoPrevista ?? null,
      orcamentoDrop: input.orcamentoDrop ?? null,
      observacoes: input.observacoes ?? null,
    },
    update: {
      produto: input.produto,
      grupo: input.grupo,
      colecao: input.colecao ?? null,
      tipoCompra: input.tipoCompra,
      statusComercial: input.statusComercial,
      possibilidadeReposicao: input.possibilidadeReposicao,
      dataLancamento: input.dataLancamento ?? null,
      dataEncerramentoPrevista: input.dataEncerramentoPrevista ?? null,
      orcamentoDrop: input.orcamentoDrop ?? null,
      observacoes: input.observacoes ?? null,
    },
  });

  if (existente) {
    const diffs: { campo: string; valorAnterior: string | null; valorNovo: string | null }[] = [];
    for (const campo of CAMPOS_HISTORICO) {
      const antes = valorParaHistorico((existente as unknown as Record<string, unknown>)[campo]);
      const depois = valorParaHistorico((input as unknown as Record<string, unknown>)[campo] ?? null);
      if (antes !== depois) diffs.push({ campo, valorAnterior: antes, valorNovo: depois });
    }
    if (diffs.length > 0) {
      await prisma.classificacaoProdutoHistorico.createMany({
        data: diffs.map((d) => ({
          classificacaoId: salvo.id,
          campo: d.campo,
          valorAnterior: d.valorAnterior,
          valorNovo: d.valorNovo,
          alteradoPor: alteradoPor ?? null,
        })),
      });
    }
  }

  return salvo;
}

export async function getClassificacaoProduto(cod: string) {
  return prisma.classificacaoProduto.findUnique({ where: { cod } });
}

export async function getHistoricoClassificacao(cod: string) {
  const c = await prisma.classificacaoProduto.findUnique({ where: { cod } });
  if (!c) return [];
  return prisma.classificacaoProdutoHistorico.findMany({
    where: { classificacaoId: c.id },
    orderBy: { alteradoEm: "desc" },
  });
}

// Fila de revisão (seção 3: "Produtos com classificação desconhecida devem aparecer em uma fila
// de revisão, sem serem automaticamente tratados como Best Seller ou Drop") — produtos que têm
// venda ou estoque recente mas NENHUMA linha em ClassificacaoProduto ainda.
export async function getFilaRevisaoClassificacao(limite = 200) {
  const [produtosComVenda, produtosComEstoque, classificados] = await Promise.all([
    prisma.sale.findMany({
      where: { status: { not: "Cancelada" } },
      distinct: ["cod"],
      select: { cod: true, produto: true, grupo: true, colecao: true },
      take: 5000,
      orderBy: { saleDate: "desc" },
    }),
    prisma.stockSnapshot.findMany({
      where: { quantidadeDisponivel: { gt: 0 } },
      distinct: ["cod"],
      select: { cod: true, produto: true, grupo: true, colecao: true },
      take: 5000,
    }),
    prisma.classificacaoProduto.findMany({ select: { cod: true } }),
  ]);

  const classificadosSet = new Set(classificados.map((c) => c.cod));
  const porCod = new Map<string, { cod: string; produto: string; grupo: string; colecao: string | null }>();
  for (const p of [...produtosComVenda, ...produtosComEstoque]) {
    if (classificadosSet.has(p.cod) || porCod.has(p.cod)) continue;
    porCod.set(p.cod, p);
  }

  return [...porCod.values()].slice(0, limite);
}

// ---------------------------------------------------------------------------
// CAMADA DE DADOS — montagem do input real a partir de Sale/StockSnapshot/ProductionOrder
// ---------------------------------------------------------------------------

const HORIZONTE_PADRAO_DIAS = 30;
const JANELA_VELOCIDADE_VENDA_DIAS = 56; // mesma janela de 8 semanas já usada em getReplenishmentPorVendas

async function getVendaMediaDiariaPorCod(cods: string[]): Promise<Map<string, { mediaDiaria: number; diasComDado: number }>> {
  if (cods.length === 0) return new Map();
  const to = new Date();
  const from = new Date(to.getTime() - JANELA_VELOCIDADE_VENDA_DIAS * 86_400_000);

  const [vendasRecentes, primeiraVenda] = await Promise.all([
    prisma.sale.groupBy({
      by: ["cod"],
      where: { status: { not: "Cancelada" }, cod: { in: cods }, saleDate: { gte: from, lte: to } },
      _sum: { quantidade: true },
    }),
    prisma.sale.groupBy({
      by: ["cod"],
      where: { status: { not: "Cancelada" }, cod: { in: cods } },
      _min: { saleDate: true },
    }),
  ]);

  const vendasByCod = new Map(vendasRecentes.map((v) => [v.cod, v._sum.quantidade ?? 0]));
  const primeiraVendaByCod = new Map(primeiraVenda.map((v) => [v.cod, v._min.saleDate]));

  const resultado = new Map<string, { mediaDiaria: number; diasComDado: number }>();
  for (const cod of cods) {
    const primeira = primeiraVendaByCod.get(cod);
    const diasDesdePrimeira = primeira ? Math.floor((to.getTime() - primeira.getTime()) / 86_400_000) : 0;
    const diasComDado = Math.min(diasDesdePrimeira, JANELA_VELOCIDADE_VENDA_DIAS);
    const totalVendido = vendasByCod.get(cod) ?? 0;
    resultado.set(cod, {
      mediaDiaria: diasComDado > 0 ? totalVendido / diasComDado : 0,
      diasComDado,
    });
  }
  return resultado;
}

// Pedidos em aberto / recebimentos previstos a partir de ProductionOrder — TVB produz
// internamente, não compra pronto de terceiro na maioria dos grupos (ver comentário em
// getStockVsSales), então "pedido em aberto" = ordem de produção sem dataFinalizacaoProducao
// ainda. IMPORTANTE (pendência real, ver relatório final item 4/5): o schema não tem campo de
// "data PREVISTA de finalização", só dataEntradaCelula (quando entrou na célula) e
// dataFinalizacaoProducao (quando terminou, null enquanto aberta) — por isso todo recebimento
// vindo daqui entra como confiavel=false até a TVB cadastrar uma previsão real. Sem isso, o motor
// de Best Seller nunca teria uma data pra comparar com o horizonte.
async function getPedidosEmAbertoPorCod(cods: string[]): Promise<Map<string, RecebimentoPrevisto[]>> {
  if (cods.length === 0) return new Map();
  const rows = await prisma.productionOrder.groupBy({
    by: ["cod"],
    where: { cod: { in: cods }, dataFinalizacaoProducao: null },
    _sum: { quantidade: true },
  });
  const map = new Map<string, RecebimentoPrevisto[]>();
  for (const r of rows) {
    const qtd = r._sum.quantidade ?? 0;
    if (qtd > 0) {
      map.set(r.cod, [{ quantidade: qtd, dataPrevista: null, confiavel: false, origem: "Ordem de produção em aberto" }]);
    }
  }
  return map;
}

export type RecomendacaoBestSellerPorProduto = SugestaoBestSeller & {
  produto: string;
  cod: string;
};

// Monta o input real e calcula a sugestão de compra Best Seller por produto (seção 4 e 6: visão
// por produto, agregável por grupo). Só considera produtos já classificados como BEST_SELLER em
// ClassificacaoProduto — produto na fila de revisão não entra aqui (pedido explícito: nunca tratar
// desconhecido como Best Seller).
export async function getRecomendacoesBestSeller(filters: { grupoIn?: string[] } = {}): Promise<RecomendacaoBestSellerPorProduto[]> {
  const classificados = await prisma.classificacaoProduto.findMany({
    where: {
      tipoCompra: TipoCompraProduto.BEST_SELLER,
      ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
    },
  });
  if (classificados.length === 0) return [];

  const cods = classificados.map((c) => c.cod);
  const [velocidade, pedidosAberto, estoqueRows, coberturaMetas] = await Promise.all([
    getVendaMediaDiariaPorCod(cods),
    getPedidosEmAbertoPorCod(cods),
    prisma.stockSnapshot.groupBy({ by: ["cod"], where: { cod: { in: cods } }, _sum: { quantidadeDisponivel: true } }),
    prisma.coberturaMeta.findMany(),
  ]);

  const estoqueByCod = new Map(estoqueRows.map((e) => [e.cod, e._sum.quantidadeDisponivel ?? 0]));
  const metaByGrupo = new Map(coberturaMetas.map((m) => [m.grupo, m]));

  return classificados.map((c) => {
    const meta = metaByGrupo.get(c.grupo);
    const horizonteCoberturaDias = meta ? Math.round(meta.mesesCobertura * 30) : HORIZONTE_PADRAO_DIAS;
    const v = velocidade.get(c.cod) ?? { mediaDiaria: 0, diasComDado: 0 };
    const sugestao = calcularSugestaoBestSeller({
      cod: c.cod,
      grupo: c.grupo,
      horizonteCoberturaDias,
      vendaMediaDiaria: v.mediaDiaria,
      diasHistoricoDisponivel: v.diasComDado,
      estoqueDisponivel: estoqueByCod.get(c.cod) ?? 0,
      estoqueSegurancaUnidades: meta?.estoqueSegurancaUnidades ?? null,
      leadTimeDias: meta?.leadTimeDias ?? null,
      recebimentosPrevistos: pedidosAberto.get(c.cod) ?? [],
    });
    return { ...sugestao, produto: c.produto, cod: c.cod };
  });
}

export type RecomendacaoDropPorProduto = SugestaoDrop & {
  produto: string;
  cod: string;
};

// Monta o input real e calcula a sugestão/risco de Drop por produto classificado como DROP.
// diasRestantesJanela vem de dataEncerramentoPrevista quando cadastrada; sem data, não há como
// saber quanto falta de janela — fica null e a função pura recebe 0 (sem previsão futura), com
// aviso explícito (não assume janela infinita nem fecha arbitrariamente).
export async function getRecomendacoesDrop(filters: { grupoIn?: string[]; colecaoIn?: string[] } = {}): Promise<RecomendacaoDropPorProduto[]> {
  const classificados = await prisma.classificacaoProduto.findMany({
    where: {
      tipoCompra: TipoCompraProduto.DROP,
      ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
      ...(filters.colecaoIn ? { colecao: { in: filters.colecaoIn } } : {}),
    },
  });
  if (classificados.length === 0) return [];

  const cods = classificados.map((c) => c.cod);
  const [velocidade, pedidosAberto, estoqueRows, vendasAcumuladasRows] = await Promise.all([
    getVendaMediaDiariaPorCod(cods),
    getPedidosEmAbertoPorCod(cods),
    prisma.stockSnapshot.groupBy({ by: ["cod"], where: { cod: { in: cods } }, _sum: { quantidadeDisponivel: true } }),
    prisma.sale.groupBy({ by: ["cod"], where: { status: { not: "Cancelada" }, cod: { in: cods } }, _sum: { quantidade: true } }),
  ]);

  const estoqueByCod = new Map(estoqueRows.map((e) => [e.cod, e._sum.quantidadeDisponivel ?? 0]));
  const vendasAcumuladasByCod = new Map(vendasAcumuladasRows.map((v) => [v.cod, v._sum.quantidade ?? 0]));
  const hoje = new Date();

  return classificados.map((c) => {
    const v = velocidade.get(c.cod) ?? { mediaDiaria: 0, diasComDado: 0 };
    const diasDesdeLancamento = c.dataLancamento
      ? Math.floor((hoje.getTime() - c.dataLancamento.getTime()) / 86_400_000)
      : null;
    const diasRestantesJanela = c.dataEncerramentoPrevista
      ? Math.max(Math.floor((c.dataEncerramentoPrevista.getTime() - hoje.getTime()) / 86_400_000), 0)
      : 0;

    const sugestao = calcularSugestaoDrop({
      cod: c.cod,
      colecao: c.colecao ?? c.produto,
      grupo: c.grupo,
      possibilidadeReposicao: c.possibilidadeReposicao,
      quantidadeCompradaOriginal: 0, // ver pendência no relatório final: não há campo de "quantidade original comprada/produzida" separado do que já foi vendido+estoque hoje
      estoqueDisponivel: estoqueByCod.get(c.cod) ?? 0,
      vendasAcumuladas: vendasAcumuladasByCod.get(c.cod) ?? 0,
      velocidadeVendaDiaria: v.mediaDiaria,
      diasDesdeLancamento,
      diasRestantesJanela,
      orcamentoDisponivelDrop: c.orcamentoDrop,
      pedidosEmAberto: pedidosAberto.get(c.cod) ?? [],
    });
    if (!c.dataEncerramentoPrevista) {
      sugestao.avisos.unshift("Sem data prevista de encerramento cadastrada para este Drop — janela comercial restante assumida como 0 (tratar faltante/excedente abaixo como indicativo, não final).");
    }
    return { ...sugestao, produto: c.produto, cod: c.cod };
  });
}

// ---------------------------------------------------------------------------
// TRILHA DE DECISÃO HUMANA (seção 9)
// ---------------------------------------------------------------------------

export type RegistrarDecisaoInput = {
  cod?: string;
  grupo: string;
  tipoCompra: TipoCompraProduto;
  quantidadeSugerida: number;
  quantidadeAprovada: number;
  justificativaAjuste?: string;
  premissas: unknown;
  decididoPor?: string;
};

// A simulação (ajustar orçamento/cobertura/previsão nas funções puras acima) nunca grava nada —
// só este passo explícito grava, com a quantidade sugerida ORIGINAL, a aprovada, e as premissas
// usadas no momento (seção 9: "registre... premissas utilizadas no cálculo").
export async function registrarDecisaoCompra(input: RegistrarDecisaoInput) {
  return prisma.decisaoCompra.create({
    data: {
      cod: input.cod ?? null,
      grupo: input.grupo,
      tipoCompra: input.tipoCompra,
      quantidadeSugerida: input.quantidadeSugerida,
      quantidadeAprovada: input.quantidadeAprovada,
      justificativaAjuste: input.justificativaAjuste ?? null,
      premissas: input.premissas as Prisma.InputJsonValue,
      decididoPor: input.decididoPor ?? null,
    },
  });
}

export async function getHistoricoDecisoesCompra(filters: { grupo?: string; cod?: string } = {}) {
  return prisma.decisaoCompra.findMany({
    where: { ...(filters.grupo ? { grupo: filters.grupo } : {}), ...(filters.cod ? { cod: filters.cod } : {}) },
    orderBy: { decididoEm: "desc" },
  });
}

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO POR GRUPO (estoque de segurança, lead time) e ORÇAMENTO GLOBAL
// ---------------------------------------------------------------------------

export async function setParametrosBestSellerGrupo(
  grupo: string,
  params: { estoqueSegurancaUnidades?: number | null; leadTimeDias?: number | null }
) {
  return prisma.coberturaMeta.upsert({
    where: { grupo },
    create: {
      grupo,
      mesesCobertura: 2,
      estoqueSegurancaUnidades: params.estoqueSegurancaUnidades ?? null,
      leadTimeDias: params.leadTimeDias ?? null,
    },
    update: {
      estoqueSegurancaUnidades: params.estoqueSegurancaUnidades ?? null,
      leadTimeDias: params.leadTimeDias ?? null,
    },
  });
}

export async function setOrcamentoTotalPlanejado(valor: number | null) {
  return prisma.mapaComprasConfig.upsert({
    where: { id: "global" },
    create: { id: "global", crescimentoPct: 0, orcamentoTotalPlanejado: valor },
    update: { orcamentoTotalPlanejado: valor },
  });
}

export async function getOrcamentoTotalPlanejado(): Promise<number | null> {
  const row = await prisma.mapaComprasConfig.findUnique({ where: { id: "global" } });
  return row?.orcamentoTotalPlanejado ?? null;
}
