import { Prisma, type ContentTipo, type ContentClassificacao } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toArray, brasiliaDayStart, brasiliaDayEnd, todayBrasiliaStr, type RawSearchParams } from "@/lib/filters";

export type PerformanceFilters = {
  perfilIn?: string[];
  tipoIn?: ContentTipo[];
  classificacaoIn?: ContentClassificacao[];
  from: Date;
  to: Date;
};

// Mesmo padrão de parseFilters() em lib/filters.ts (dias em horário de Brasília, padrão de
// período recente) — domínio diferente (conteúdo/influenciador, não venda/estoque), por isso um
// parser próprio em vez de reaproveitar parseFilters, que é todo desenhado em cima de loja/marca.
export function parsePerformanceFilters(params: RawSearchParams): PerformanceFilters {
  const perfilSelecionado = toArray(params.perfil);
  const tipoSelecionado = toArray(params.tipo).filter((t): t is ContentTipo => t === "STORY" || t === "POST");
  const classificacaoSelecionada = toArray(params.classificacao).filter(
    (c): c is ContentClassificacao => c === "QUALIFICADO" || c === "BASICO"
  );

  const DEFAULT_DIAS_ATRAS = 90;
  const now = new Date();
  const defaultFromStr = todayBrasiliaStr(new Date(now.getTime() - DEFAULT_DIAS_ATRAS * 86400000));

  const from =
    typeof params.from === "string" && params.from ? brasiliaDayStart(params.from) : brasiliaDayStart(defaultFromStr);
  const to = typeof params.to === "string" && params.to ? brasiliaDayEnd(params.to) : now;

  return {
    perfilIn: perfilSelecionado.length > 0 ? perfilSelecionado : undefined,
    tipoIn: tipoSelecionado.length > 0 ? tipoSelecionado : undefined,
    classificacaoIn: classificacaoSelecionada.length > 0 ? classificacaoSelecionada : undefined,
    from,
    to,
  };
}

function contentWhere(filters: PerformanceFilters): Prisma.ContentPerformanceWhereInput {
  return {
    data: { gte: filters.from, lte: filters.to },
    ...(filters.perfilIn ? { perfil: { in: filters.perfilIn } } : {}),
    ...(filters.tipoIn ? { tipo: { in: filters.tipoIn } } : {}),
    ...(filters.classificacaoIn ? { classificacao: { in: filters.classificacaoIn } } : {}),
  };
}

export async function getDistinctPerfis(): Promise<string[]> {
  const rows = await prisma.contentPerformance.findMany({ distinct: ["perfil"], select: { perfil: true } });
  return rows.map((r) => r.perfil).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function getContentRecords(filters: PerformanceFilters) {
  return prisma.contentPerformance.findMany({
    where: contentWhere(filters),
    orderBy: { data: "desc" },
  });
}

export async function getContentById(id: string) {
  return prisma.contentPerformance.findUnique({ where: { id } });
}

function pct(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null;
}

function avg(sum: number, count: number): number | null {
  return count > 0 ? sum / count : null;
}

export async function getPerformanceSummary(filters: PerformanceFilters) {
  const rows = await prisma.contentPerformance.findMany({
    where: contentWhere(filters),
    select: { tipo: true, classificacao: true, engajamento: true },
  });

  const totalConteudos = rows.length;
  const stories = rows.filter((r) => r.tipo === "STORY").length;
  const posts = rows.filter((r) => r.tipo === "POST").length;
  const qualificados = rows.filter((r) => r.classificacao === "QUALIFICADO").length;
  const basicos = rows.filter((r) => r.classificacao === "BASICO").length;
  const comEngajamento = rows.filter((r) => r.engajamento != null);
  const engajamentoTotal = comEngajamento.reduce((s, r) => s + (r.engajamento ?? 0), 0);

  return {
    totalConteudos,
    stories,
    posts,
    qualificados,
    basicos,
    pctQualificados: pct(qualificados, totalConteudos),
    engajamentoTotal: comEngajamento.length > 0 ? engajamentoTotal : null,
    engajamentoMedio: avg(engajamentoTotal, comEngajamento.length),
    // Quantos registros realmente têm engajamento lançado — pra deixar claro na tela quando a
    // média é sobre uma amostra menor que o total de conteúdos.
    comEngajamento: comEngajamento.length,
  };
}

export type RankingRow = {
  perfil: string;
  conteudos: number;
  stories: number;
  posts: number;
  qualificados: number;
  pctQualificacao: number | null;
  engajamentoTotal: number | null;
  engajamentoMedio: number | null;
  comEngajamento: number;
};

export async function getPerformanceRanking(filters: PerformanceFilters): Promise<RankingRow[]> {
  const rows = await prisma.contentPerformance.findMany({
    where: contentWhere(filters),
    select: { perfil: true, tipo: true, classificacao: true, engajamento: true },
  });

  const byPerfil = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byPerfil.get(r.perfil) ?? [];
    arr.push(r);
    byPerfil.set(r.perfil, arr);
  }

  return [...byPerfil.entries()].map(([perfil, itens]) => {
    const qualificados = itens.filter((i) => i.classificacao === "QUALIFICADO").length;
    const comEng = itens.filter((i) => i.engajamento != null);
    const engajamentoTotal = comEng.reduce((s, i) => s + (i.engajamento ?? 0), 0);
    return {
      perfil,
      conteudos: itens.length,
      stories: itens.filter((i) => i.tipo === "STORY").length,
      posts: itens.filter((i) => i.tipo === "POST").length,
      qualificados,
      pctQualificacao: pct(qualificados, itens.length),
      engajamentoTotal: comEng.length > 0 ? engajamentoTotal : null,
      engajamentoMedio: avg(engajamentoTotal, comEng.length),
      comEngajamento: comEng.length,
    };
  });
}

export async function getStoriesVsPosts(filters: PerformanceFilters) {
  const rows = await prisma.contentPerformance.findMany({
    where: contentWhere(filters),
    select: { tipo: true, classificacao: true, engajamento: true },
  });
  const total = rows.length;

  return (["STORY", "POST"] as const).map((tipo) => {
    const itens = rows.filter((r) => r.tipo === tipo);
    const qualificados = itens.filter((r) => r.classificacao === "QUALIFICADO").length;
    const comEng = itens.filter((r) => r.engajamento != null);
    const engajamentoTotal = comEng.reduce((s, r) => s + (r.engajamento ?? 0), 0);
    return {
      tipo,
      quantidade: itens.length,
      pctQualificados: pct(qualificados, itens.length),
      engajamentoTotal: comEng.length > 0 ? engajamentoTotal : null,
      engajamentoMedio: avg(engajamentoTotal, comEng.length),
      participacaoPct: pct(itens.length, total),
    };
  });
}

export async function getQualificadoVsBasico(filters: PerformanceFilters) {
  const rows = await prisma.contentPerformance.findMany({
    where: contentWhere(filters),
    select: { classificacao: true, engajamento: true },
  });
  const total = rows.length;

  return (["QUALIFICADO", "BASICO"] as const).map((classificacao) => {
    const itens = rows.filter((r) => r.classificacao === classificacao);
    const comEng = itens.filter((r) => r.engajamento != null);
    const engajamentoTotal = comEng.reduce((s, r) => s + (r.engajamento ?? 0), 0);
    return {
      classificacao,
      quantidade: itens.length,
      pct: pct(itens.length, total),
      engajamentoMedio: avg(engajamentoTotal, comEng.length),
      comEngajamento: comEng.length,
    };
  });
}

export type Granularidade = "dia" | "semana" | "mes";

export async function getPerformanceEvolucao(filters: PerformanceFilters, granularidade: Granularidade) {
  const trunc = granularidade === "dia" ? "day" : granularidade === "semana" ? "week" : "month";
  const rows = await prisma.$queryRaw<
    { periodo: Date; tipo: ContentTipo; classificacao: ContentClassificacao; engajamento: number | null }[]
  >`
    SELECT
      date_trunc(${trunc}, (("data" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')) AS periodo,
      "tipo",
      "classificacao",
      "engajamento"
    FROM "ContentPerformance"
    WHERE "data" >= ${filters.from} AND "data" <= ${filters.to}
      ${filters.perfilIn ? Prisma.sql`AND "perfil" = ANY(${filters.perfilIn})` : Prisma.empty}
      ${filters.tipoIn ? Prisma.sql`AND "tipo" = ANY(${filters.tipoIn}::"ContentTipo"[])` : Prisma.empty}
      ${filters.classificacaoIn ? Prisma.sql`AND "classificacao" = ANY(${filters.classificacaoIn}::"ContentClassificacao"[])` : Prisma.empty}
  `;

  const byPeriodo = new Map<
    string,
    { conteudos: number; qualificados: number; engajamentoTotal: number; comEngajamento: number }
  >();
  for (const r of rows) {
    const key = new Date(r.periodo).toISOString().slice(0, 10);
    const cur = byPeriodo.get(key) ?? { conteudos: 0, qualificados: 0, engajamentoTotal: 0, comEngajamento: 0 };
    cur.conteudos++;
    if (r.classificacao === "QUALIFICADO") cur.qualificados++;
    if (r.engajamento != null) {
      cur.engajamentoTotal += r.engajamento;
      cur.comEngajamento++;
    }
    byPeriodo.set(key, cur);
  }

  return [...byPeriodo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, v]) => ({
      periodo,
      conteudos: v.conteudos,
      qualificados: v.qualificados,
      pctQualificacao: pct(v.qualificados, v.conteudos),
      engajamentoMedio: avg(v.engajamentoTotal, v.comEngajamento),
    }));
}

export async function getPerfilDetalhe(perfil: string, filters: PerformanceFilters) {
  const rows = await prisma.contentPerformance.findMany({
    where: { ...contentWhere({ ...filters, perfilIn: undefined }), perfil },
    orderBy: { data: "desc" },
  });
  if (rows.length === 0) return null;

  const qualificados = rows.filter((r) => r.classificacao === "QUALIFICADO").length;
  const comEng = rows.filter((r) => r.engajamento != null);
  const engajamentoTotal = comEng.reduce((s, r) => s + (r.engajamento ?? 0), 0);

  const comEngOrdenado = [...comEng].sort((a, b) => (b.engajamento ?? 0) - (a.engajamento ?? 0));

  return {
    perfil,
    totalConteudos: rows.length,
    stories: rows.filter((r) => r.tipo === "STORY").length,
    posts: rows.filter((r) => r.tipo === "POST").length,
    qualificados,
    basicos: rows.filter((r) => r.classificacao === "BASICO").length,
    pctQualificacao: pct(qualificados, rows.length),
    engajamentoTotal: comEng.length > 0 ? engajamentoTotal : null,
    engajamentoMedio: avg(engajamentoTotal, comEng.length),
    melhoresConteudos: comEngOrdenado.slice(0, 5),
    pioresConteudos: comEngOrdenado.length > 5 ? comEngOrdenado.slice(-5).reverse() : [],
    registros: rows,
  };
}
