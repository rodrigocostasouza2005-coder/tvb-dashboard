import { avaliarMultimarcas, type CandidatoProspect } from "./motor-elegibilidade";

/**
 * Motor de pontuação (0-100) — SÓ pode ser chamado sobre um candidato que já recebeu
 * APROVADO_GATE em avaliarEliminacao (motor-elegibilidade.ts). Este arquivo não sabe nem se
 * importa com o gate: é responsabilidade de quem chama (motor-qualificacao.ts) garantir isso.
 * Pesos exatos do pedido do Rodrigo: multimarcas 30 / moda masculina 25 / operação comprovada 20
 * / qualidade da informação 15 / potencial comercial 10 = 100.
 *
 * Cada sub-score é computado e devolvido junto da razão — nunca só o número final — pra dar pra
 * auditar depois "por que esse prospect tirou 82 e não 90".
 */

export type ClassificacaoProspect = "ALTA_PRIORIDADE" | "QUALIFICADO" | "REPROVADO";

export type SubScore = {
  criterio: string;
  pontos: number;
  maximo: number;
  rationale: string;
};

export type ResultadoPontuacao = {
  total: number;
  classificacao: ClassificacaoProspect;
  subScores: SubScore[];
};

export const PONTO_CORTE_APROVACAO = 75;
export const PONTO_CORTE_ALTA_PRIORIDADE = 85;

type EntradaPontuacao = Pick<
  CandidatoProspect,
  | "marcas"
  | "evidenciaModaMasculina"
  | "evidenciaAtividadeComercial"
  | "evidenciaVarejoVestuario"
  | "evidenciaPosicionamentoTvb"
> & {
  /** Sinais adicionais de qualidade/confiabilidade da informação coletada. */
  fontesOficiaisConsultadas: boolean;
  fontesMultiplas: boolean;
  informacaoAtualizada: boolean;
  /** Sinais adicionais de potencial comercial (porte, localização estratégica, volume indicado etc). */
  potencialComercialSinais: Array<{ descricao: string }>;
};

function pontuarMultimarcas(c: EntradaPontuacao): SubScore {
  const { marcasValidas } = avaliarMultimarcas(c.marcas);
  const n = marcasValidas.length;
  // Base de 18 por já atender o mínimo exigido pelo gate (2 marcas); bônus por marca extra
  // (até 8, ou seja +2 marcas já no teto) e bônus de confiança quando a maioria das evidências é ALTA.
  const base = n >= 2 ? 18 : 0;
  const bonusQuantidade = Math.max(0, Math.min(8, (n - 2) * 3));
  const altas = marcasValidas.filter((m) => m.confianca === "ALTA").length;
  const bonusConfianca = n > 0 && altas === n ? 4 : n > 0 && altas >= Math.ceil(n / 2) ? 2 : 0;
  const pontos = Math.min(30, base + bonusQuantidade + bonusConfianca);
  return {
    criterio: "Evidência de revenda multimarcas",
    pontos,
    maximo: 30,
    rationale: `${n} marca(s) distinta(s) comprovada(s)${altas ? `, ${altas} com confiança ALTA` : ""}.`,
  };
}

function pontuarModaMasculina(c: EntradaPontuacao): SubScore {
  const n = c.evidenciaModaMasculina.length;
  const pontos = n === 0 ? 0 : Math.min(25, 10 + n * 5);
  return {
    criterio: "Compatibilidade com moda masculina",
    pontos,
    maximo: 25,
    rationale: `${n} evidência(s) de linha masculina comercialmente relevante.`,
  };
}

function pontuarOperacaoComercial(c: EntradaPontuacao): SubScore {
  const atividade = c.evidenciaAtividadeComercial.length;
  const varejo = c.evidenciaVarejoVestuario.length;
  const pontos = atividade + varejo === 0 ? 0 : Math.min(20, 8 + atividade * 4 + varejo * 4);
  return {
    criterio: "Operação comercial comprovada",
    pontos,
    maximo: 20,
    rationale: `${atividade} evidência(s) de atividade comercial e ${varejo} de varejo de vestuário.`,
  };
}

function pontuarQualidadeInformacao(c: EntradaPontuacao): SubScore {
  const pontos = (c.fontesOficiaisConsultadas ? 5 : 0) + (c.fontesMultiplas ? 5 : 0) + (c.informacaoAtualizada ? 5 : 0);
  const partes = [
    c.fontesOficiaisConsultadas ? "fontes oficiais consultadas" : "sem fonte oficial",
    c.fontesMultiplas ? "múltiplas fontes independentes" : "fonte única",
    c.informacaoAtualizada ? "informação atualizada" : "informação possivelmente desatualizada",
  ];
  return { criterio: "Qualidade e confiabilidade da informação", pontos, maximo: 15, rationale: partes.join("; ") + "." };
}

function pontuarPotencialComercial(c: EntradaPontuacao): SubScore {
  const posicionamento = c.evidenciaPosicionamentoTvb.length > 0 ? 6 : 0;
  const sinais = Math.min(4, c.potencialComercialSinais.length * 2);
  const pontos = posicionamento + sinais;
  return {
    criterio: "Potencial comercial e posicionamento",
    pontos,
    maximo: 10,
    rationale: `${posicionamento > 0 ? "compatível" : "sem evidência de compatibilidade"} com o posicionamento TVB; ${c.potencialComercialSinais.length} sinal(is) de potencial comercial.`,
  };
}

function classificar(total: number): ClassificacaoProspect {
  if (total >= PONTO_CORTE_ALTA_PRIORIDADE) return "ALTA_PRIORIDADE";
  if (total >= PONTO_CORTE_APROVACAO) return "QUALIFICADO";
  return "REPROVADO";
}

/**
 * Calcula o score 0-100 e a classificação. IMPORTANTE: esta função não verifica o gate — quem
 * chama (ver motor-qualificacao.ts) é responsável por só invocá-la depois de avaliarEliminacao
 * retornar APROVADO_GATE. Chamar isto sobre um candidato reprovado produziria um número sem
 * sentido (a pontuação assume que os 6 critérios obrigatórios já foram satisfeitos).
 */
export function pontuarProspect(c: EntradaPontuacao): ResultadoPontuacao {
  const subScores = [
    pontuarMultimarcas(c),
    pontuarModaMasculina(c),
    pontuarOperacaoComercial(c),
    pontuarQualidadeInformacao(c),
    pontuarPotencialComercial(c),
  ];
  const total = subScores.reduce((soma, s) => soma + s.pontos, 0);
  return { total, classificacao: classificar(total), subScores };
}
