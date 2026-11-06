import { validarCnpj } from "./cnpj";
import { normalizarChave } from "./normalizacao-texto";

/**
 * Motor de elegibilidade — rebuild do núcleo de qualificação B2B (2026-11, Fase 1 do pedido do
 * Rodrigo: "quero 300 prospects excelentes, não 5000 CNPJs inúteis"). Este arquivo implementa
 * SÓ o gate obrigatório de eliminação. Pontuação (0-100) fica em motor-pontuacao.ts e só pode
 * rodar sobre quem passou aqui — ver motor-qualificacao.ts pra orquestração completa.
 *
 * Reaproveitado do pipeline anterior (auditado antes de reescrever, PR #43/#48/#49):
 * - validarCnpj (cnpj.ts): dígito verificador, sem mudança.
 * - A filosofia "nunca aprovar sozinho, sempre existe uma pendência pra revisão humana"
 *   já existia em avaliacao-comercial.ts/agente-pesquisa-comercial.ts — mantida aqui no
 *   statusComercial (ver motor-qualificacao.ts), nunca neste gate.
 * - CNAE como filtro de descoberta, nunca prova de revenda multimarcas (regra do PR #43) —
 *   preservada e reforçada: este gate nem recebe CNAE como entrada, só evidência observada.
 *
 * Reescrito (não reaproveitado) porque o pipeline anterior:
 * - misturava eliminação e pontuação em avaliacao-comercial.ts (um único score de 0-100 que já
 *   zerava em bloqueio, mas sem registrar PORQUE cada critério obrigatório passou/falhou);
 * - media "marcas" por um dicionário fixo (pesquisa-web.ts MARCAS) sem registrar fonte, data,
 *   tipo de evidência nem confiança por marca — não dava pra auditar depois "por que essa marca
 *   contou";
 * - não tinha lista explícita de bloqueio automático (lingerie/joalheria/móveis/alimentação/
 *   brechó/alfaiate sem multimarcas/infantil) como estrutura de dados nomeada — vivia espalhado
 *   em arrays de string de pesquisa-web.ts (EXCLUSOES).
 */

export type NivelConfianca = "ALTA" | "MEDIA" | "BAIXA";

export type TipoEvidenciaMarca =
  | "SITE_OFICIAL"
  | "CATALOGO_PRODUTO"
  | "INSTAGRAM_COMERCIAL"
  | "POST_PRODUTO"
  | "FOTO_VITRINE"
  | "MARKETPLACE"
  | "OUTRA_FONTE_VERIFICAVEL";

/**
 * Evidência de UMA marca de terceiro efetivamente revendida. "Multimarcas" como autodescrição
 * ("somos multimarcas") nunca entra aqui — só evidência concreta de uma marca específica.
 */
export type EvidenciaMarca = {
  marca: string;
  evidencia: string;
  fonteUrl: string;
  dataVerificacao: Date;
  tipoEvidencia: TipoEvidenciaMarca;
  confianca: NivelConfianca;
};

/** Evidência genérica (existência, atividade, varejo, moda masculina, posicionamento TVB). */
export type Evidencia = {
  descricao: string;
  fonteUrl: string | null;
  dataVerificacao: Date;
};

/**
 * Categorias de bloqueio automático (lista fechada do pedido do Rodrigo) — presença de QUALQUER
 * uma destas reprova o candidato, nenhuma pontuação pode compensar. Preenchidas pelo agente de
 * pesquisa (fase futura), nunca inferidas aqui a partir de texto livre.
 */
export type CategoriaBloqueio =
  | "FABRICANTE_SEM_REVENDA"
  | "SOMENTE_MARCA_PROPRIA"
  | "LINGERIE"
  | "JOALHERIA_BIJUTERIA"
  | "MOVEIS"
  | "ALIMENTACAO"
  | "BRECHO_USADOS"
  | "ALFAIATE_SEM_MULTIMARCAS"
  | "SOMENTE_FEMININO"
  | "SOMENTE_INFANTIL"
  | "CADASTRO_INATIVO_OU_INVALIDO"
  | "SEM_EVIDENCIA_SUFICIENTE";

export type SituacaoCadastral = "ATIVA" | "SUSPENSA" | "INAPTA" | "BAIXADA" | "NULA" | "DESCONHECIDA" | "NAO_INFORMADA";

/** Dossiê de evidências de um candidato — entrada do gate. Nenhum campo é inferido aqui. */
export type CandidatoProspect = {
  nomeFantasia: string;
  cnpj: string | null;
  situacaoCadastral: SituacaoCadastral | null;
  /** Categorias de bloqueio já identificadas pela pesquisa (ver tipo acima). */
  categoriasBloqueio: CategoriaBloqueio[];
  /** Critério 1: existência verificável (ex.: CNPJ oficial batendo com Receita/Serpro). */
  evidenciaExistencia: Evidencia[];
  /** Critério 2: atividade comercial real (ex.: posts recentes, avaliações de clientes, Google Meu Negócio ativo). */
  evidenciaAtividadeComercial: Evidencia[];
  /** Critério 3: operação de varejo de vestuário (loja física/online vendendo roupa, não fábrica). */
  evidenciaVarejoVestuario: Evidencia[];
  /** Critério 4: linha masculina comercialmente relevante (não só um produto isolado). */
  evidenciaModaMasculina: Evidencia[];
  /** Critério 5 (central): marcas de terceiros com evidência individual — ver avaliarMultimarcas. */
  marcas: EvidenciaMarca[];
  /** Critério 6: compatibilidade com o posicionamento comercial da TVB (surf/skate/streetwear masculino). */
  evidenciaPosicionamentoTvb: Evidencia[];
};

export type ResultadoCriterio = {
  id: "EXISTENCIA" | "ATIVIDADE_COMERCIAL" | "VAREJO_VESTUARIO" | "MODA_MASCULINA" | "MULTIMARCAS" | "POSICIONAMENTO_TVB";
  resultado: "ATENDE" | "NAO_ATENDE" | "INCONCLUSIVO";
  motivo: string;
};

export type ResultadoEliminacao = {
  /**
   * APROVADO_GATE: todos os 6 critérios obrigatórios atendidos — pode ir pra pontuação.
   * REPROVADO: ao menos um critério falhou de forma definitiva (inclui qualquer bloqueio
   *            automático) — reprovação final, nunca é pontuado.
   * INCONCLUSIVO: nenhum critério falhou, mas falta evidência pra confirmar ao menos um —
   *            precisa de mais pesquisa antes de decidir (nem aprovado nem reprovado ainda).
   */
  resultado: "APROVADO_GATE" | "REPROVADO" | "INCONCLUSIVO";
  criterios: ResultadoCriterio[];
  motivosReprovacao: string[];
};

const BLOQUEIOS_NAO_VAREJO: CategoriaBloqueio[] = [
  "FABRICANTE_SEM_REVENDA",
  "LINGERIE",
  "JOALHERIA_BIJUTERIA",
  "MOVEIS",
  "ALIMENTACAO",
  "BRECHO_USADOS",
  "ALFAIATE_SEM_MULTIMARCAS",
];

/**
 * Prova de revenda multimarcas — o requisito central do pedido do Rodrigo. Conta só marcas
 * DISTINTAS (duas linhas da MESMA marca nunca contam como duas) e exige, por marca, evidência +
 * fonte + data + tipo + confiança preenchidos (um registro incompleto não prova nada e é
 * descartado da contagem, não "conta mesmo assim").
 */
export function avaliarMultimarcas(marcas: EvidenciaMarca[]): {
  marcasValidas: EvidenciaMarca[];
  marcasDistintas: string[];
  comprovado: boolean;
} {
  const completas = marcas.filter(
    (m) => m.marca.trim() && m.evidencia.trim() && m.fonteUrl.trim() && m.tipoEvidencia && m.confianca && m.dataVerificacao,
  );
  const porChave = new Map<string, EvidenciaMarca>();
  for (const marca of completas) {
    const chave = normalizarChave(marca.marca);
    if (!porChave.has(chave)) porChave.set(chave, marca);
  }
  const marcasValidas = [...porChave.values()];
  return {
    marcasValidas,
    marcasDistintas: marcasValidas.map((m) => m.marca),
    // Mínimo de 2 marcas distintas e comprovadas — "não comprovado" é reprovação definitiva,
    // nunca um estado intermediário (ver uso em avaliarEliminacao: NAO_ATENDE, não INCONCLUSIVO).
    comprovado: marcasValidas.length >= 2,
  };
}

function criterioExistencia(c: CandidatoProspect): ResultadoCriterio {
  if (c.categoriasBloqueio.includes("CADASTRO_INATIVO_OU_INVALIDO")) {
    return { id: "EXISTENCIA", resultado: "NAO_ATENDE", motivo: "Situação cadastral inativa, inválida ou não verificável." };
  }
  const cnpjValido = c.cnpj ? Boolean(validarCnpj(c.cnpj)) : false;
  if (cnpjValido && c.situacaoCadastral === "ATIVA" && c.evidenciaExistencia.length > 0) {
    return { id: "EXISTENCIA", resultado: "ATENDE", motivo: "CNPJ válido, situação cadastral ATIVA e existência confirmada por evidência." };
  }
  return { id: "EXISTENCIA", resultado: "INCONCLUSIVO", motivo: "Falta confirmar CNPJ, situação cadastral oficial ou evidência de existência." };
}

function criterioAtividadeComercial(c: CandidatoProspect): ResultadoCriterio {
  if (c.categoriasBloqueio.includes("SEM_EVIDENCIA_SUFICIENTE")) {
    return { id: "ATIVIDADE_COMERCIAL", resultado: "NAO_ATENDE", motivo: "Pesquisa concluída sem evidência comercial suficiente." };
  }
  if (c.evidenciaAtividadeComercial.length > 0) {
    return { id: "ATIVIDADE_COMERCIAL", resultado: "ATENDE", motivo: "Atividade comercial real evidenciada." };
  }
  return { id: "ATIVIDADE_COMERCIAL", resultado: "INCONCLUSIVO", motivo: "Ainda sem evidência de atividade comercial real." };
}

function criterioVarejoVestuario(c: CandidatoProspect): ResultadoCriterio {
  const bloqueio = c.categoriasBloqueio.find((b) => BLOQUEIOS_NAO_VAREJO.includes(b));
  if (bloqueio) {
    return { id: "VAREJO_VESTUARIO", resultado: "NAO_ATENDE", motivo: `Categoria incompatível com varejo de vestuário multimarcas: ${bloqueio}.` };
  }
  if (c.evidenciaVarejoVestuario.length > 0) {
    return { id: "VAREJO_VESTUARIO", resultado: "ATENDE", motivo: "Operação de varejo de vestuário evidenciada." };
  }
  return { id: "VAREJO_VESTUARIO", resultado: "INCONCLUSIVO", motivo: "Ainda sem evidência de operação de varejo de vestuário." };
}

function criterioModaMasculina(c: CandidatoProspect): ResultadoCriterio {
  if (c.categoriasBloqueio.includes("SOMENTE_FEMININO")) {
    return { id: "MODA_MASCULINA", resultado: "NAO_ATENDE", motivo: "Loja exclusivamente feminina." };
  }
  if (c.categoriasBloqueio.includes("SOMENTE_INFANTIL")) {
    return { id: "MODA_MASCULINA", resultado: "NAO_ATENDE", motivo: "Loja exclusivamente infantil." };
  }
  if (c.evidenciaModaMasculina.length > 0) {
    return { id: "MODA_MASCULINA", resultado: "ATENDE", motivo: "Linha de moda masculina comercialmente relevante evidenciada." };
  }
  return { id: "MODA_MASCULINA", resultado: "INCONCLUSIVO", motivo: "Ainda sem evidência de linha masculina relevante." };
}

function criterioMultimarcas(c: CandidatoProspect): ResultadoCriterio {
  if (c.categoriasBloqueio.includes("SOMENTE_MARCA_PROPRIA") || c.categoriasBloqueio.includes("FABRICANTE_SEM_REVENDA")) {
    return { id: "MULTIMARCAS", resultado: "NAO_ATENDE", motivo: "Fabricante ou revendedor exclusivo de marca própria, sem revenda de terceiros." };
  }
  const { comprovado, marcasDistintas } = avaliarMultimarcas(c.marcas);
  if (comprovado) {
    return { id: "MULTIMARCAS", resultado: "ATENDE", motivo: `Revenda multimarcas comprovada: ${marcasDistintas.join(", ")}.` };
  }
  // Regra explícita do Rodrigo: sem 2+ marcas de terceiros comprovadas, reprovação definitiva —
  // nunca um estado intermediário que possa "amadurecer" sozinho pra aprovação depois.
  return {
    id: "MULTIMARCAS",
    resultado: "NAO_ATENDE",
    motivo: marcasDistintas.length === 1
      ? "Apenas 1 marca de terceiro comprovada; mínimo exigido é 2 marcas distintas."
      : "Nenhuma marca de terceiro comprovada com evidência (fonte, data, tipo e confiança registrados).",
  };
}

function criterioPosicionamentoTvb(c: CandidatoProspect): ResultadoCriterio {
  if (c.evidenciaPosicionamentoTvb.length > 0) {
    return { id: "POSICIONAMENTO_TVB", resultado: "ATENDE", motivo: "Posicionamento compatível com TVB (surf/skate/streetwear masculino) evidenciado." };
  }
  return { id: "POSICIONAMENTO_TVB", resultado: "INCONCLUSIVO", motivo: "Ainda sem evidência de compatibilidade com o posicionamento comercial da TVB." };
}

/**
 * Roda os 6 critérios obrigatórios. Qualquer NAO_ATENDE (inclusive bloqueio automático) basta
 * pra reprovar — mesmo que outros critérios estejam só INCONCLUSIVO. Só quando NENHUM critério
 * falhou e NENHUM está inconclusivo o resultado é APROVADO_GATE (único caso em que a pontuação
 * em motor-pontuacao.ts pode rodar).
 */
export function avaliarEliminacao(c: CandidatoProspect): ResultadoEliminacao {
  const criterios: ResultadoCriterio[] = [
    criterioExistencia(c),
    criterioAtividadeComercial(c),
    criterioVarejoVestuario(c),
    criterioModaMasculina(c),
    criterioMultimarcas(c),
    criterioPosicionamentoTvb(c),
  ];
  const falhas = criterios.filter((x) => x.resultado === "NAO_ATENDE");
  const inconclusivos = criterios.filter((x) => x.resultado === "INCONCLUSIVO");
  const resultado = falhas.length > 0 ? "REPROVADO" : inconclusivos.length > 0 ? "INCONCLUSIVO" : "APROVADO_GATE";
  return { resultado, criterios, motivosReprovacao: falhas.map((f) => f.motivo) };
}
