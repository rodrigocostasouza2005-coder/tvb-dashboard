import { ehCapitalEstadual } from "./capitais-estaduais";

/**
 * Cota geográfica de cobertura da prospecção (Fase 1 do rebuild, 2026-11) — função pura, sem
 * banco, pensada pra alimentar a descoberta nacional de uma fase futura (26 UFs + DF), que NÃO
 * roda nesta tarefa. Regra do Rodrigo: até 2 lojas qualificadas por município; capital estadual
 * é exceção e substitui (não soma) esse limite por até 5. É um TETO de cobertura, nunca uma meta
 * — nunca preencher a cota com candidato mais fraco só pra "completar"; município sem nenhuma
 * loja aprovável fica com zero linhas, e isso é o resultado correto, não um bug a corrigir.
 */
export const QUOTA_PADRAO_MUNICIPIO = 2;
export const QUOTA_CAPITAL_ESTADUAL = 5;

export function limiteQuotaMunicipio(uf: string, municipio: string | null | undefined): number {
  return ehCapitalEstadual(uf, municipio) ? QUOTA_CAPITAL_ESTADUAL : QUOTA_PADRAO_MUNICIPIO;
}

export type CandidatoParaQuota = {
  id: string;
  uf: string;
  municipio: string | null | undefined;
  /** Score comercial (0-100) já calculado pelo motor de pontuação; só entra quem já passou pelo gate. */
  score: number;
};

export type ResultadoQuotaGeografica = {
  /** Ids aprovados dentro da cota, agrupados por chave "UF|município", já ordenados por score desc. */
  aprovados: string[];
  /**
   * Ids que, mesmo qualificados, excederam a cota do município (o Nº (limite)+1º em diante por
   * score) — ficam fora da base definitiva por excesso de cobertura local, não por reprovação de
   * qualidade. Quem chama decide o destino deles (ex: manter em fila de espera).
   */
  excedentesPorCota: string[];
  /** Diagnóstico por município: quantos qualificados entraram vs. o limite aplicado. */
  porMunicipio: Array<{ uf: string; municipio: string; limite: number; qualificados: number; aprovados: number }>;
};

/**
 * Aplica a cota por município sobre uma lista de candidatos QUE JÁ PASSARAM pelo gate de
 * elegibilidade e pontuação (ver motor-qualificacao.ts) — esta função não elimina nem pontua
 * nada, só decide COBERTURA GEOGRÁFICA entre quem já é elegível. Dentro do mesmo município,
 * prioriza maior score; em caso de empate exato, usa o id como critério estável (determinístico,
 * sem depender de ordem de inserção do array de entrada).
 */
export function aplicarQuotaGeografica(candidatos: CandidatoParaQuota[]): ResultadoQuotaGeografica {
  const grupos = new Map<string, { uf: string; municipio: string; itens: CandidatoParaQuota[] }>();
  for (const candidato of candidatos) {
    const uf = candidato.uf.trim().toUpperCase();
    const municipio = (candidato.municipio ?? "").trim();
    const chave = `${uf}|${municipio}`;
    const grupo = grupos.get(chave) ?? { uf, municipio, itens: [] };
    grupo.itens.push(candidato);
    grupos.set(chave, grupo);
  }

  const aprovados: string[] = [];
  const excedentesPorCota: string[] = [];
  const porMunicipio: ResultadoQuotaGeografica["porMunicipio"] = [];

  for (const { uf, municipio, itens } of grupos.values()) {
    const limite = limiteQuotaMunicipio(uf, municipio);
    const ordenados = [...itens].sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const dentroDaCota = ordenados.slice(0, limite);
    const fora = ordenados.slice(limite);
    aprovados.push(...dentroDaCota.map((c) => c.id));
    excedentesPorCota.push(...fora.map((c) => c.id));
    porMunicipio.push({ uf, municipio, limite, qualificados: itens.length, aprovados: dentroDaCota.length });
  }

  return { aprovados, excedentesPorCota, porMunicipio };
}
