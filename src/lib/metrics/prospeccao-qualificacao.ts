import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Camada de leitura do resultado do motor de qualificação B2B (schema do PR #51:
 * classificacaoProspect/statusComercial/resultadoEliminacao/motivosEliminacao/scoreDetalhe/
 * evidenciasQualificacao/tipoEstabelecimento/cnpjRaiz/capitalEstadual + AtacadoProspectBrand).
 * Só leitura — nunca escreve statusComercial/classificacaoProspect aqui. A UI (aba Prospecção)
 * consome só isto; o motor em si (motor-*.ts) e os agentes que o alimentam (scripts/prospeccao/
 * agente-*.ts) são escopo de outro trabalho em paralelo.
 *
 * Reality check (2026-11): statusComercial de quase todo prospect hoje é EM_INVESTIGACAO (default)
 * porque o motor ainda não rodou pra valer na base nacional — as queries abaixo frequentemente
 * voltam vazias em produção. Isso é esperado, não é bug; cada função/empty-state foi desenhado
 * pra isso (ver qualificacao-*.tsx).
 */

export type FiltroQualificacao = {
  estado?: string;
  municipio?: string;
  capital?: "capital" | "interior";
  classificacao?: "ALTA_PRIORIDADE" | "QUALIFICADO";
};

export function montarWhereQualificacao(filtro: FiltroQualificacao): Prisma.AtacadoProspectWhereInput {
  return {
    ...(filtro.estado ? { estado: filtro.estado } : {}),
    ...(filtro.municipio ? { cidade: { contains: filtro.municipio, mode: "insensitive" as const } } : {}),
    ...(filtro.capital === "capital" ? { capitalEstadual: true } : {}),
    ...(filtro.capital === "interior" ? { capitalEstadual: false } : {}),
    ...(filtro.classificacao ? { classificacaoProspect: filtro.classificacao } : {}),
  };
}

const BRANDS_INCLUDE = { brands: { orderBy: { createdAt: "asc" as const } } };
const ACTIVITIES_RECENTES = { activities: { orderBy: { createdAt: "desc" as const }, take: 5 } };

export async function listarAprovados(filtro: FiltroQualificacao, take = 200) {
  return prisma.atacadoProspect.findMany({
    where: { statusComercial: "APROVADO", ...montarWhereQualificacao(filtro) },
    include: { ...BRANDS_INCLUDE, ...ACTIVITIES_RECENTES },
    orderBy: [{ classificacaoProspect: "asc" }, { updatedAt: "desc" }],
    take,
  });
}

export async function listarPendentesRevisao(filtro: FiltroQualificacao, take = 200) {
  return prisma.atacadoProspect.findMany({
    where: { statusComercial: "PENDENTE_REVISAO_HUMANA", ...montarWhereQualificacao(filtro) },
    include: BRANDS_INCLUDE,
    orderBy: [{ classificacaoProspect: "asc" }, { updatedAt: "desc" }],
    take,
  });
}

export async function listarReprovados(filtro: FiltroQualificacao, take = 200) {
  return prisma.atacadoProspect.findMany({
    where: { statusComercial: "REPROVADO", ...montarWhereQualificacao(filtro) },
    orderBy: { updatedAt: "desc" },
    take,
  });
}

export type ProspectoAprovado = Awaited<ReturnType<typeof listarAprovados>>[number];
export type ProspectoPendente = Awaited<ReturnType<typeof listarPendentesRevisao>>[number];
export type ProspectoReprovado = Awaited<ReturnType<typeof listarReprovados>>[number];

export type ContagemStatusComercial = {
  aprovado: number;
  altaPrioridade: number;
  qualificado: number;
  pendente: number;
  emInvestigacao: number;
  reprovado: number;
};

export async function contarPorStatusComercial(): Promise<ContagemStatusComercial> {
  const [aprovado, altaPrioridade, qualificado, pendente, emInvestigacao, reprovado] = await Promise.all([
    prisma.atacadoProspect.count({ where: { statusComercial: "APROVADO" } }),
    prisma.atacadoProspect.count({ where: { statusComercial: "APROVADO", classificacaoProspect: "ALTA_PRIORIDADE" } }),
    prisma.atacadoProspect.count({ where: { statusComercial: "APROVADO", classificacaoProspect: "QUALIFICADO" } }),
    prisma.atacadoProspect.count({ where: { statusComercial: "PENDENTE_REVISAO_HUMANA" } }),
    prisma.atacadoProspect.count({ where: { statusComercial: "EM_INVESTIGACAO" } }),
    prisma.atacadoProspect.count({ where: { statusComercial: "REPROVADO" } }),
  ]);
  return { aprovado, altaPrioridade, qualificado, pendente, emInvestigacao, reprovado };
}

// Só estado/município de quem já passou pelo motor (aprovado ou pendente) — não faz sentido
// oferecer no filtro um estado onde só existem prospects ainda EM_INVESTIGACAO sem nada pra ver.
const ESTADOS_COM_RESULTADO: Prisma.AtacadoProspectWhereInput = {
  statusComercial: { in: ["APROVADO", "PENDENTE_REVISAO_HUMANA"] },
};

export async function listarEstadosDisponiveis(): Promise<string[]> {
  const rows = await prisma.atacadoProspect.findMany({
    where: { ...ESTADOS_COM_RESULTADO, estado: { not: null } },
    distinct: ["estado"],
    select: { estado: true },
    orderBy: { estado: "asc" },
  });
  return rows.map((r) => r.estado).filter((v): v is string => Boolean(v));
}

export async function listarMunicipiosDisponiveis(estado?: string): Promise<string[]> {
  const rows = await prisma.atacadoProspect.findMany({
    where: { ...ESTADOS_COM_RESULTADO, cidade: { not: null }, ...(estado ? { estado } : {}) },
    distinct: ["cidade"],
    select: { cidade: true },
    orderBy: { cidade: "asc" },
    take: 300,
  });
  return rows.map((r) => r.cidade).filter((v): v is string => Boolean(v));
}

// --- Parsing defensivo dos campos Json (scoreDetalhe/evidenciasQualificacao) ---
// Nenhum agente grava estes campos ainda em produção (motor acabou de ser religado em paralelo),
// então o shape abaixo é o CONTRATO esperado (espelha motor-pontuacao.ts/motor-elegibilidade.ts),
// mas o parser nunca lança — um Json fora do formato esperado só faz a seção correspondente da UI
// mostrar "sem detalhamento disponível" em vez de quebrar a página.

export type SubScoreParsed = { criterio: string; pontos: number; maximo: number; rationale: string };
export type ScoreDetalheParsed = { total: number; classificacao: string; subScores: SubScoreParsed[] };

export function parseScoreDetalhe(json: unknown): ScoreDetalheParsed | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.total !== "number" || typeof obj.classificacao !== "string") return null;
  const subScores = Array.isArray(obj.subScores)
    ? obj.subScores
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({
          criterio: typeof s.criterio === "string" ? s.criterio : "",
          pontos: typeof s.pontos === "number" ? s.pontos : 0,
          maximo: typeof s.maximo === "number" ? s.maximo : 0,
          rationale: typeof s.rationale === "string" ? s.rationale : "",
        }))
    : [];
  return { total: obj.total, classificacao: obj.classificacao, subScores };
}

export type CriterioParsed = { id: string; resultado: string; motivo: string };
export type EvidenciasParsed = { criterios: CriterioParsed[]; motivosReprovacao: string[] };

export function parseEvidenciasQualificacao(json: unknown): EvidenciasParsed | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  const criterios = Array.isArray(obj.criterios)
    ? obj.criterios
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          id: typeof c.id === "string" ? c.id : "",
          resultado: typeof c.resultado === "string" ? c.resultado : "",
          motivo: typeof c.motivo === "string" ? c.motivo : "",
        }))
    : [];
  const motivosReprovacao = Array.isArray(obj.motivosReprovacao) ? obj.motivosReprovacao.map(String) : [];
  if (!criterios.length && !motivosReprovacao.length) return null;
  return { criterios, motivosReprovacao };
}
