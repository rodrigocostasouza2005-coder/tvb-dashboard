import { prisma } from "@/lib/prisma";

// Motor de Premissas de Crescimento — evolução do Mapa de Compras (pedido do Rodrigo, 2026-11-27,
// seções 7 a 12 do briefing). Substitui o % único de MapaComprasConfig.crescimentoPct (aplicado
// igual pra empresa toda) por um motor de 3 componentes combináveis:
//   1. CENÁRIO (Conservador/Base/Agressivo) — %/ano de referência, editável.
//   2. AJUSTE RELATIVO por posição de estoque (loja/CD-Site) e por grupo de produto — multiplicador
//      sobre o %/ano do cenário (1.0 = segue o cenário puro).
//   3. AJUSTE MANUAL por mês do calendário — pontos percentuais somados por fora da multiplicação
//      (ex: reforçar Novembro pra Black Friday sem comprimir o efeito dos multiplicadores acima).
// Um 4º componente, MOMENTUM (tendência recente real, não editável — calculado, ver
// calcularMomentum/getMomentumPorGrupo), multiplica o resultado final.
//
// Fórmula (documentada aqui pra nunca virar caixa-preta, seção 12 do briefing):
//   crescimentoEfetivo = (cenarioPct/100) × ajusteLoja × ajusteGrupo + ajusteMensalPontos/100
//   projetado = baseComparável (mesmo mês, ano anterior) × (1 + crescimentoEfetivo) × momentum
//
// "base" é SEMPRE o mesmo valor de MapaComprasConfig.crescimentoPct — nunca uma 2ª fonte de
// verdade: updateCrescimentoAction (tela antiga) e a Premissas de Crescimento (tela nova) editam
// a MESMA coluna. Conservador/Agressivo vivem em CrescimentoCenario (tabela nova).

export type Cenario = "conservador" | "base" | "agressivo";
export const CENARIOS: Cenario[] = ["conservador", "base", "agressivo"];

export function nomeCenario(c: Cenario): string {
  switch (c) {
    case "conservador":
      return "Conservador";
    case "agressivo":
      return "Agressivo";
    default:
      return "Base";
  }
}

// Valores ilustrativos SÓ usados quando a linha ainda não foi configurada (1ª vez que a tela é
// aberta) — nunca sobrescrevem um valor já salvo. Mesmos números de exemplo citados no briefing
// (seção 8), claramente editáveis na própria tela, não uma métrica calculada.
const DEFAULT_PRESETS: Record<Cenario, number> = { conservador: 5, base: 12, agressivo: 20 };

export type PremissasCrescimento = {
  cenarioAtivo: Cenario;
  presets: Record<Cenario, number>; // %/ano
  ajusteLoja: Record<string, number>; // posicaoId (ver getPosicoesEstoque) -> multiplicador
  ajusteGrupo: Record<string, number>; // grupo -> multiplicador
  ajusteMensal: Record<number, number>; // mesCalendario 1-12 -> pontos percentuais
};

export async function getPremissasCrescimento(): Promise<PremissasCrescimento> {
  const [config, cenarios, ajustesLoja, ajustesGrupo, ajustesMensal] = await Promise.all([
    prisma.mapaComprasConfig.findUnique({ where: { id: "global" } }),
    prisma.crescimentoCenario.findMany(),
    prisma.crescimentoAjusteLoja.findMany(),
    prisma.crescimentoAjusteGrupo.findMany(),
    prisma.crescimentoAjusteMensal.findMany(),
  ]);

  const presets = { ...DEFAULT_PRESETS };
  for (const c of cenarios) {
    if (c.id === "conservador" || c.id === "agressivo") presets[c.id] = c.crescimentoPct;
  }
  // "base" nunca lê de CrescimentoCenario, mesmo que alguém force uma linha id="base" lá —
  // MapaComprasConfig.crescimentoPct é a única fonte pra esse cenário específico.
  presets.base = config?.crescimentoPct ?? DEFAULT_PRESETS.base;

  const cenarioAtivoRaw = config?.cenarioAtivo ?? "base";
  const cenarioAtivo: Cenario = (CENARIOS as string[]).includes(cenarioAtivoRaw) ? (cenarioAtivoRaw as Cenario) : "base";

  return {
    cenarioAtivo,
    presets,
    ajusteLoja: Object.fromEntries(ajustesLoja.map((a) => [a.posicaoId, a.multiplicador])),
    ajusteGrupo: Object.fromEntries(ajustesGrupo.map((a) => [a.grupo, a.multiplicador])),
    ajusteMensal: Object.fromEntries(ajustesMensal.map((a) => [a.mesCalendario, a.ajustePontos])),
  };
}

export async function setCenarioAtivo(cenario: Cenario): Promise<void> {
  await prisma.mapaComprasConfig.upsert({
    where: { id: "global" },
    create: { id: "global", crescimentoPct: DEFAULT_PRESETS.base, cenarioAtivo: cenario },
    update: { cenarioAtivo: cenario },
  });
}

export async function setCenarioPreset(cenario: Cenario, crescimentoPct: number): Promise<void> {
  if (cenario === "base") {
    // Mesma coluna que updateCrescimentoAction (tela antiga) já edita — 1 fonte de verdade.
    await prisma.mapaComprasConfig.upsert({
      where: { id: "global" },
      create: { id: "global", crescimentoPct, cenarioAtivo: "base" },
      update: { crescimentoPct },
    });
    return;
  }
  await prisma.crescimentoCenario.upsert({
    where: { id: cenario },
    create: { id: cenario, crescimentoPct },
    update: { crescimentoPct },
  });
}

export async function setAjusteLoja(posicaoId: string, multiplicador: number): Promise<void> {
  await prisma.crescimentoAjusteLoja.upsert({
    where: { posicaoId },
    create: { posicaoId, multiplicador },
    update: { multiplicador },
  });
}

export async function setAjusteGrupo(grupo: string, multiplicador: number): Promise<void> {
  await prisma.crescimentoAjusteGrupo.upsert({
    where: { grupo },
    create: { grupo, multiplicador },
    update: { multiplicador },
  });
}

export async function setAjusteMensal(mesCalendario: number, ajustePontos: number): Promise<void> {
  await prisma.crescimentoAjusteMensal.upsert({
    where: { mesCalendario },
    create: { mesCalendario, ajustePontos },
    update: { ajustePontos },
  });
}

// Pura, testável sem banco — ver fórmula documentada no topo do arquivo. `posicaoId` opcional
// porque nem todo consumidor tem granularidade de loja (ex: getMapaDeComprasDetalhado hoje é
// consolidado por grupo, sem quebra por loja — ver decisão documentada no PR).
export function calcularCrescimentoEfetivo(
  premissas: PremissasCrescimento,
  opts: { grupo?: string; posicaoId?: string; mesCalendario: number },
  cenario: Cenario = premissas.cenarioAtivo
): number {
  const base = premissas.presets[cenario] / 100;
  const ajusteLoja = opts.posicaoId ? (premissas.ajusteLoja[opts.posicaoId] ?? 1) : 1;
  const ajusteGrupo = opts.grupo ? (premissas.ajusteGrupo[opts.grupo] ?? 1) : 1;
  const ajusteMensal = (premissas.ajusteMensal[opts.mesCalendario] ?? 0) / 100;
  return base * ajusteLoja * ajusteGrupo + ajusteMensal;
}

// Momentum (seção 7B do briefing) — tendência recente real, independente da sazonalidade (que já
// vem embutida na baseComparável = mesmo mês, ano anterior). Compara receita líquida dos últimos
// MOMENTUM_JANELA_DIAS contra os mesmos dias imediatamente anteriores (2 janelas reais, nunca uma
// projeção em cima da outra). Capado em [0.8, 1.2] — sem o cap, um grupo com pouquíssima venda
// recente (poucas dezenas de R$) pode gerar uma razão de 3x/0.1x só por ruído estatístico, e o
// resto do motor (que multiplica por isso) herdaria esse ruído como se fosse sinal real.
export const MOMENTUM_JANELA_DIAS = 60;
const MOMENTUM_MIN = 0.8;
const MOMENTUM_MAX = 1.2;

export function calcularMomentum(receitaRecente: number, receitaAnterior: number): number {
  if (receitaAnterior <= 0) return 1; // sem base de comparação -> neutro, nunca inventa tendência
  const razao = receitaRecente / receitaAnterior;
  return Math.min(MOMENTUM_MAX, Math.max(MOMENTUM_MIN, razao));
}

// Receita líquida de devolução por grupo nas 2 janelas de MOMENTUM_JANELA_DIAS (mesmo padrão de
// Math.max(0, venda - devolução) já usado em core.ts/returnWhere, achado 1 da auditoria de
// 2026-11-26) — devolve o momentum já calculado por grupo, pronto pro motor de projeção.
export async function getMomentumPorGrupo(grupos: string[], agora: Date = new Date()): Promise<Map<string, number>> {
  if (grupos.length === 0) return new Map();
  const fimRecente = agora;
  const inicioRecente = new Date(agora.getTime() - MOMENTUM_JANELA_DIAS * 86_400_000);
  const inicioAnterior = new Date(inicioRecente.getTime() - MOMENTUM_JANELA_DIAS * 86_400_000);

  const [vendasRecentes, devolucaoRecentes, vendasAnteriores, devolucaoAnteriores] = await Promise.all([
    prisma.sale.groupBy({
      by: ["grupo"],
      where: { status: { not: "Cancelada" }, grupo: { in: grupos }, saleDate: { gte: inicioRecente, lt: fimRecente } },
      _sum: { valorTotalLiquido: true },
    }),
    prisma.return.groupBy({
      by: ["grupo"],
      where: { status: { not: "Cancelada" }, grupo: { in: grupos }, returnDate: { gte: inicioRecente, lt: fimRecente } },
      _sum: { valorTotal: true },
    }),
    prisma.sale.groupBy({
      by: ["grupo"],
      where: { status: { not: "Cancelada" }, grupo: { in: grupos }, saleDate: { gte: inicioAnterior, lt: inicioRecente } },
      _sum: { valorTotalLiquido: true },
    }),
    prisma.return.groupBy({
      by: ["grupo"],
      where: { status: { not: "Cancelada" }, grupo: { in: grupos }, returnDate: { gte: inicioAnterior, lt: inicioRecente } },
      _sum: { valorTotal: true },
    }),
  ]);

  function liquidoPorGrupo(
    vendas: { grupo: string; _sum: { valorTotalLiquido: number | null } }[],
    devolucoes: { grupo: string; _sum: { valorTotal: number | null } }[]
  ): Map<string, number> {
    const devMap = new Map(devolucoes.map((d) => [d.grupo, d._sum.valorTotal ?? 0]));
    const m = new Map<string, number>();
    for (const v of vendas) m.set(v.grupo, Math.max(0, (v._sum.valorTotalLiquido ?? 0) - (devMap.get(v.grupo) ?? 0)));
    return m;
  }
  const recenteMap = liquidoPorGrupo(vendasRecentes, devolucaoRecentes);
  const anteriorMap = liquidoPorGrupo(vendasAnteriores, devolucaoAnteriores);

  const resultado = new Map<string, number>();
  for (const g of grupos) resultado.set(g, calcularMomentum(recenteMap.get(g) ?? 0, anteriorMap.get(g) ?? 0));
  return resultado;
}

// Receita líquida de devolução por grupo×mês, numa janela [desde, ate) — usada tanto pelo
// detalhamento da projeção (base comparável de um mês específico) quanto pelo backtest (receita
// real de meses já encerrados). Mesmo padrão de DATE_TRUNC com fuso América/São_Paulo já usado em
// getMapaDeComprasDetalhado (estoque.ts), pra nunca divergir de como a matriz principal já conta
// "mês".
export async function getReceitaLiquidaPorGrupoMes(
  grupos: string[],
  desde: Date,
  ate: Date
): Promise<Map<string, Map<string, number>>> {
  if (grupos.length === 0) return new Map();
  const [vendas, devolucoes] = await Promise.all([
    prisma.$queryRaw<{ grupo: string; mes: Date; receita: number }[]>`
      SELECT "grupo", DATE_TRUNC('month', ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS mes, SUM("valorTotalLiquido") AS receita
      FROM "Sale"
      WHERE "status" != 'Cancelada' AND "saleDate" >= ${desde} AND "saleDate" < ${ate} AND "grupo" = ANY(${grupos})
      GROUP BY "grupo", mes
    `,
    prisma.$queryRaw<{ grupo: string; mes: Date; receita: number }[]>`
      SELECT "grupo", DATE_TRUNC('month', ("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS mes, SUM("valorTotal") AS receita
      FROM "Return"
      WHERE "status" != 'Cancelada' AND "returnDate" >= ${desde} AND "returnDate" < ${ate} AND "grupo" = ANY(${grupos})
      GROUP BY "grupo", mes
    `,
  ]);

  const mesKey = (d: Date) => d.toISOString().slice(0, 7);
  const chave = (grupo: string, mes: Date) => `${grupo}::${mesKey(mes)}`;
  const devMap = new Map(devolucoes.map((d) => [chave(d.grupo, d.mes), Number(d.receita)]));

  const resultado = new Map<string, Map<string, number>>();
  for (const v of vendas) {
    const liquido = Math.max(0, Number(v.receita) - (devMap.get(chave(v.grupo, v.mes)) ?? 0));
    if (!resultado.has(v.grupo)) resultado.set(v.grupo, new Map());
    resultado.get(v.grupo)!.set(mesKey(v.mes), liquido);
  }
  return resultado;
}

// Detalhamento da projeção (seção 12 do briefing: "não quero uma caixa preta") — mostra de onde
// veio um número projetado específico (grupo + mês), com cada componente da fórmula explícito.
export type DetalheProjecaoGrupo = {
  grupo: string;
  mes: string; // "YYYY-MM"
  baseComparavel: number;
  cenario: Cenario;
  presetCenario: number; // %/ano
  ajusteLoja: number | null; // null quando a projeção não é específica de 1 posição
  ajusteGrupo: number;
  ajusteMensalPontos: number;
  crescimentoEfetivo: number; // fração (ex: 0.143 = 14,3%)
  momentum: number;
  resultado: number;
};

export function detalharProjecaoGrupo(
  premissas: PremissasCrescimento,
  opts: { grupo: string; mes: string; baseComparavel: number; momentum: number; posicaoId?: string }
): DetalheProjecaoGrupo {
  const mesCalendario = Number(opts.mes.split("-")[1]);
  const cenario = premissas.cenarioAtivo;
  const crescimentoEfetivo = calcularCrescimentoEfetivo(
    premissas,
    { grupo: opts.grupo, posicaoId: opts.posicaoId, mesCalendario },
    cenario
  );
  const resultado = Math.max(0, opts.baseComparavel * (1 + crescimentoEfetivo) * opts.momentum);
  return {
    grupo: opts.grupo,
    mes: opts.mes,
    baseComparavel: opts.baseComparavel,
    cenario,
    presetCenario: premissas.presets[cenario],
    ajusteLoja: opts.posicaoId ? (premissas.ajusteLoja[opts.posicaoId] ?? 1) : null,
    ajusteGrupo: premissas.ajusteGrupo[opts.grupo] ?? 1,
    ajusteMensalPontos: premissas.ajusteMensal[mesCalendario] ?? 0,
    crescimentoEfetivo,
    momentum: opts.momentum,
    resultado,
  };
}

// Backtest (seção 13 do briefing) — refaz a projeção de um mês JÁ REALIZADO com a MESMA fórmula
// (reaproveita detalharProjecaoGrupo) e compara com o que de fato aconteceu. Sinaliza erro/viés,
// mas NUNCA é apresentado como validação estatística real — só "a fórmula de hoje teria acertado
// isso no passado", útil pra calibrar premissas, não uma métrica de acurácia certificada.
export type PontoBacktest = { mes: string; previsto: number; realizado: number; erroPct: number | null };

export function backtestGrupo(
  premissas: PremissasCrescimento,
  pontos: { grupo: string; mes: string; baseComparavel: number; momentum: number; realizado: number }[]
): PontoBacktest[] {
  return pontos.map((p) => {
    const detalhe = detalharProjecaoGrupo(premissas, {
      grupo: p.grupo,
      mes: p.mes,
      baseComparavel: p.baseComparavel,
      momentum: p.momentum,
    });
    const erroPct = p.realizado > 0 ? (detalhe.resultado - p.realizado) / p.realizado : null;
    return { mes: p.mes, previsto: Math.round(detalhe.resultado), realizado: Math.round(p.realizado), erroPct };
  });
}
