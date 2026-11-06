import { normalizarChave } from "./normalizacao-texto";
import {
  avaliarMultimarcas,
  type CategoriaBloqueio,
  type Evidencia,
  type EvidenciaMarca,
  type NivelConfianca,
  type SituacaoCadastral,
} from "./motor-elegibilidade";
import type { EntradaQualificacao, ResultadoQualificacao } from "./motor-qualificacao";
import type { CandidatoParaQuota } from "./quota-geografica";
import type { EvidenciaSite } from "./pesquisa-web";

/**
 * Camada de adaptação entre os scripts reais (scripts/prospeccao/agente-qualificacao.ts e
 * agente-pesquisa-comercial.ts) e o núcleo do motor (motor-elegibilidade.ts/motor-pontuacao.ts/
 * motor-qualificacao.ts, Fase 1 — PR #51). Propósito único: traduzir o que cada etapa do
 * pipeline sabe (dados cadastrais da Receita, ou evidência coletada numa pesquisa web) para o
 * formato que o motor entende — nunca duplica a lógica de eliminação/pontuação em si.
 *
 * Fica fora de src/lib/prospeccao/motor-*.ts de propósito: o motor em si (auditado no PR #51)
 * não deveria precisar saber de onde vem a evidência (Receita, site, Serpro); isolar essa
 * tradução aqui deixa o motor estável e esta camada livre pra evoluir junto dos scripts.
 */

const SITUACOES_CADASTRAIS_BLOQUEANTES = new Set<SituacaoCadastral>(["SUSPENSA", "INAPTA", "BAIXADA", "NULA"]);

/**
 * Evidência de existência cadastral — compartilhada pelos dois adaptadores abaixo porque o fato
 * que a sustenta (CNPJ válido + contato cadastral presente na base pública) é o mesmo nas duas
 * etapas do pipeline; centralizar aqui evita que uma das duas acabe mais permissiva que a outra
 * por engano.
 */
export function evidenciaExistenciaBase(cnpjValido: boolean, hasContato: boolean, dataVerificacao: Date): Evidencia[] {
  return cnpjValido && hasContato
    ? [
        {
          descricao: "CNPJ válido e contato cadastral (telefone/e-mail) presente na base pública da Receita Federal.",
          fonteUrl: null,
          dataVerificacao,
        },
      ]
    : [];
}

/**
 * ATENÇÃO (descoberta ao escrever os testes deste arquivo, não é só comentário teórico): o
 * critério MULTIMARCAS em motor-elegibilidade.ts não tem estado INCONCLUSIVO por desenho — zero
 * marca comprovada é reprovação definitiva imediata (ver comentário em criterioMultimarcas).
 * Isso é correto e intencional para o motor completo, mas por isso `qualificarProspect`/
 * `avaliarEliminacao` NUNCA deve ser chamado na etapa cadastral (logo após a importação da
 * Receita Federal, antes de qualquer pesquisa comercial): nessa etapa NENHUM candidato tem
 * evidência de marca ainda, então rodar o gate completo aqui reprovaria 100% dos candidatos
 * só por faltar evidência que a pesquisa comercial ainda nem teve a chance de coletar — não é
 * "ficar pendente", é descartar o pipeline inteiro no nascimento.
 *
 * Por isso este adaptador NÃO expõe uma função "montarCandidatoCadastral" que alimenta o gate
 * completo. A etapa cadastral (agente-qualificacao.ts) continua usando sua própria triagem
 * (avaliacao-cadastral.ts, inalterada) para decidir quem entra na fila de pesquisa comercial —
 * isso é uma pergunta genuinamente diferente de "este candidato passa no gate de elegibilidade
 * B2B". O único ponto de entrada real do motor completo é `montarCandidatoPesquisaComercial`
 * abaixo, chamado de agente-pesquisa-comercial.ts, porque é a única etapa em que evidência de
 * marca de terceiro pode de fato existir. `calcularCnpjRaiz`/`ehCapitalEstadual` (este último
 * reexportado de capitais-estaduais.ts) seguem sendo seguros de usar já na etapa cadastral, por
 * serem derivações puras de CNPJ/UF/município, sem depender de nenhuma evidência comercial.
 */
export function calcularCnpjRaiz(cnpj: string | null | undefined): string | null {
  const digitos = (cnpj ?? "").trim();
  return digitos.length >= 8 ? digitos.slice(0, 8) : null;
}

/**
 * Mapa fechado de termos de exclusão (ver pesquisa-web.ts EXCLUSOES) para a categoria de
 * bloqueio tipada que o motor espera. pesquisa-web.ts mistura lingerie/joalheria/móveis/
 * alimentação numa única lista de string; esta tabela é o que recupera a categoria certa pra
 * cada termo encontrado, sem precisar alterar pesquisa-web.ts (que é anterior ao rebuild e
 * continua em uso por outros scripts). Termos sem categoria correspondente aqui (ex.: brechó,
 * alfaiate sem multimarcas) simplesmente não têm sinal de origem ainda — nenhuma categoria é
 * inventada para eles.
 */
const EXCLUSAO_PARA_CATEGORIA: Array<{ termos: string[]; categoria: CategoriaBloqueio }> = [
  { categoria: "LINGERIE", termos: ["loja de lingerie", "lingerie", "moda íntima", "sutiã", "calcinha"] },
  { categoria: "JOALHERIA_BIJUTERIA", termos: ["semijoias", "bijuterias", "loja de bijuterias", "joalheria"] },
  {
    categoria: "MOVEIS",
    termos: ["loja de móveis", "móveis planejados", "estofados", "colchões", "loja de decoração"],
  },
  {
    categoria: "ALIMENTACAO",
    termos: [
      "restaurante", "pizzaria", "lanchonete", "hamburgueria", "churrascaria", "sushi",
      "padaria", "cafeteria", "supermercado", "mercearia", "açougue", "alimentos", "delivery de comida",
    ],
  },
];

function categoriasDeExclusao(sinaisExclusao: string[]): CategoriaBloqueio[] {
  const chaves = new Set(sinaisExclusao.map((termo) => normalizarChave(termo)));
  const categorias = new Set<CategoriaBloqueio>();
  for (const { termos, categoria } of EXCLUSAO_PARA_CATEGORIA) {
    if (termos.some((termo) => chaves.has(normalizarChave(termo)))) categorias.add(categoria);
  }
  return [...categorias];
}

export type EntradaPesquisaComercial = {
  nomeFantasia: string;
  cnpj: string | null;
  cnpjValido: boolean;
  hasContato: boolean;
  situacaoCadastral: SituacaoCadastral | null;
  confianca: NivelConfianca;
  /** URL do site já confirmado como pertencente à loja (confianca !== BAIXA); null se não confirmado. */
  siteConfirmado: string | null;
  /** Melhor URL disponível pra citar como fonte (site confirmado, ou candidato ainda não confirmado). */
  urlReferencia: string | null;
  evidencia: EvidenciaSite | null;
  dataVerificacao: Date;
  fontesOficiaisConsultadas: boolean;
  instagramEncontrado: boolean;
  potencialComercialSinais: Array<{ descricao: string }>;
};

/**
 * Monta o candidato da etapa de pesquisa comercial (agente-pesquisa-comercial.ts) — é aqui que
 * moda masculina, multimarcas e posicionamento TVB podem de fato ser confirmados ou negados.
 * Deliberadamente conservador: marca de terceiro só entra em `marcas` (e portanto só pode contar
 * pro requisito central de multimarcas) quando o site tem um SINAL EXPLÍCITO de revenda
 * multimarcas — citar o nome de uma marca de passagem (num blog, numa lista de "marcas que admiramos"
 * etc.) nunca basta, igual já era em avaliacao-comercial.ts. Isso mantém o pipeline tão
 * conservador quanto (ou mais que) o anterior — nunca mais permissivo.
 */
export function montarCandidatoPesquisaComercial(input: EntradaPesquisaComercial): EntradaQualificacao {
  const ev = input.evidencia;
  const categoriasBloqueio: CategoriaBloqueio[] = [];
  if (!input.cnpjValido) categoriasBloqueio.push("CADASTRO_INATIVO_OU_INVALIDO");
  else if (input.situacaoCadastral && SITUACOES_CADASTRAIS_BLOQUEANTES.has(input.situacaoCadastral)) {
    categoriasBloqueio.push("CADASTRO_INATIVO_OU_INVALIDO");
  }
  if (ev?.sinaisExclusao?.length) categoriasBloqueio.push(...categoriasDeExclusao(ev.sinaisExclusao));
  if ((ev?.sinaisMarcaPropria?.length ?? 0) > 0) categoriasBloqueio.push("SOMENTE_MARCA_PROPRIA");
  const masculino = (ev?.sinaisModaMasculina?.length ?? 0) > 0;
  const feminino = (ev?.sinaisModaFeminina?.length ?? 0) > 0;
  if (feminino && !masculino) categoriasBloqueio.push("SOMENTE_FEMININO");

  const siteConfiavel = input.confianca !== "BAIXA" && Boolean(input.siteConfirmado) && Boolean(ev);
  const fonteUrl = input.siteConfirmado ?? input.urlReferencia;

  const evidenciaAtividadeComercial: Evidencia[] = siteConfiavel
    ? [{ descricao: `Site oficial localizado e validado (confiança ${input.confianca}).`, fonteUrl, dataVerificacao: input.dataVerificacao }]
    : [];
  const evidenciaVarejoVestuario: Evidencia[] = siteConfiavel
    ? [{ descricao: "Conteúdo do site oficial confirma operação de varejo de vestuário.", fonteUrl, dataVerificacao: input.dataVerificacao }]
    : [];
  const evidenciaModaMasculina: Evidencia[] = masculino
    ? [{ descricao: `Sinais textuais de moda masculina: ${ev!.sinaisModaMasculina.join(", ")}.`, fonteUrl, dataVerificacao: input.dataVerificacao }]
    : [];
  const evidenciaPosicionamentoTvb: Evidencia[] = (ev?.sinaisSurfSkate?.length ?? 0) > 0
    ? [{ descricao: `Sinais de posicionamento surf/skate/streetwear: ${ev!.sinaisSurfSkate!.join(", ")}.`, fonteUrl, dataVerificacao: input.dataVerificacao }]
    : [];

  const marcas: EvidenciaMarca[] = siteConfiavel && ev && ev.sinaisMultimarcas.length > 0 && fonteUrl
    ? [...new Set(ev.marcas)].map((marcaNome) => ({
        marca: marcaNome,
        evidencia: `Marca citada no site oficial junto de sinal explícito de revenda multimarcas (${ev.sinaisMultimarcas.join(", ")}).`,
        fonteUrl,
        dataVerificacao: input.dataVerificacao,
        tipoEvidencia: "SITE_OFICIAL" as const,
        confianca: input.confianca,
      }))
    : [];

  // Curadoria dinâmica de marcas (Fase 3, faxina pós-auditoria 2026-11): marcas candidatas fora
  // das 24 referências fixas (ver pesquisa-web.ts MARCAS/extrairMarcasCandidatas) passam pelo
  // MESMO gate de evidência que as 24 (siteConfiavel + sinal explícito de multimarcas + fonteUrl)
  // — nunca uma régua mais permissiva. A única diferença deliberada: confiança sempre rebaixada
  // pra MEDIA no máximo, mesmo quando a identidade do site é ALTA. Detectar um padrão de texto não
  // é o mesmo que confirmar uma marca já catalogada; isso nunca vira aprovação automática (o
  // próprio motor já nunca grava APROVADO sozinho — ver motor-qualificacao.ts), mas garante que
  // uma marca nova nunca pesa tanto na pontuação quanto uma das 24 já confirmadas (ver
  // pontuarMultimarcas em motor-pontuacao.ts, bônus de confiança por marca ALTA).
  const confiancaMarcaCandidata: NivelConfianca = input.confianca === "ALTA" ? "MEDIA" : input.confianca;
  const marcasCandidatas: EvidenciaMarca[] = siteConfiavel && ev && ev.sinaisMultimarcas.length > 0 && fonteUrl && (ev.marcasCandidatas?.length ?? 0) > 0
    ? [...new Set(ev.marcasCandidatas)].map((marcaNome) => ({
        marca: marcaNome,
        evidencia: `Marca candidata fora da lista de 24 referências fixas, identificada em texto imediatamente após sinal explícito de revenda multimarcas (${ev.sinaisMultimarcas.join(", ")}); confiança limitada a MEDIA por ser detecção por padrão de texto, não confirmação humana nem fonte estruturada prévia.`,
        fonteUrl,
        dataVerificacao: input.dataVerificacao,
        tipoEvidencia: "SITE_OFICIAL" as const,
        confianca: confiancaMarcaCandidata,
      }))
    : [];

  return {
    nomeFantasia: input.nomeFantasia,
    cnpj: input.cnpj,
    situacaoCadastral: input.situacaoCadastral,
    categoriasBloqueio,
    // Esta etapa não reconfirma existência cadastral do zero: reaproveita o mesmo fato-base
    // (CNPJ válido + contato) usado na triagem cadastral, pra não regredir um critério que já
    // tinha sido atendido só porque esta chamada não é a etapa de cadastro.
    evidenciaExistencia: evidenciaExistenciaBase(input.cnpjValido, input.hasContato, input.dataVerificacao),
    evidenciaAtividadeComercial,
    evidenciaVarejoVestuario,
    evidenciaModaMasculina,
    marcas: [...marcas, ...marcasCandidatas],
    evidenciaPosicionamentoTvb,
    fontesOficiaisConsultadas: input.fontesOficiaisConsultadas,
    fontesMultiplas: Boolean(input.siteConfirmado) && input.instagramEncontrado,
    informacaoAtualizada: true,
    potencialComercialSinais: input.potencialComercialSinais,
  };
}

export type RegistroQualificacao = {
  statusComercial: ResultadoQualificacao["statusComercial"];
  classificacaoProspect: "ALTA_PRIORIDADE" | "QUALIFICADO" | "REPROVADO" | null;
  resultadoEliminacao: ResultadoQualificacao["eliminacao"]["resultado"];
  motivosEliminacao: string[];
  scoreDetalhe: Record<string, unknown> | null;
  evidenciasQualificacao: Record<string, unknown>;
  scoreComercial: number | null;
  justificativaGrupo: string;
  /** Status de workflow (campo legado `status`, string livre) — nunca algo que pareça aprovação. */
  status: "DESCARTADO" | "EM_QUALIFICACAO";
};

/**
 * Traduz o resultado do motor (ResultadoQualificacao) pros campos de persistência em
 * AtacadoProspect. Pura — não grava nada, só decide o QUE gravar; quem chama (os scripts) decide
 * COMO e QUANDO gravar (sempre atrás de --apply). `status` legado só assume "DESCARTADO" quando
 * o motor reprovou (gate ou pontuação); nunca grava nada que pareça aprovação — isso continua
 * sendo exclusivamente uma promoção manual, fora deste código.
 */
export function montarRegistroQualificacao(resultado: ResultadoQualificacao): RegistroQualificacao {
  return {
    statusComercial: resultado.statusComercial,
    classificacaoProspect: resultado.pontuacao?.classificacao ?? null,
    resultadoEliminacao: resultado.eliminacao.resultado,
    motivosEliminacao: resultado.eliminacao.motivosReprovacao,
    scoreDetalhe: resultado.pontuacao
      ? { total: resultado.pontuacao.total, classificacao: resultado.pontuacao.classificacao, subScores: resultado.pontuacao.subScores }
      : null,
    evidenciasQualificacao: { criterios: resultado.eliminacao.criterios },
    scoreComercial: resultado.pontuacao?.total ?? null,
    justificativaGrupo: resultado.motivo,
    status: resultado.statusComercial === "REPROVADO" ? "DESCARTADO" : "EM_QUALIFICACAO",
  };
}

export type OperacaoMarca = {
  marcaNormalizada: string;
  marca: string;
  evidencia: string;
  fonteUrl: string;
  dataVerificacao: Date;
  tipoEvidencia: EvidenciaMarca["tipoEvidencia"];
  confianca: EvidenciaMarca["confianca"];
};

/**
 * Prepara as linhas de AtacadoProspectBrand a partir das marcas do candidato — reaproveita
 * avaliarMultimarcas (motor-elegibilidade.ts) como única fonte de verdade de dedupe, pra nunca
 * gravar uma marca que o próprio gate não considerou válida (evidência incompleta) nem duplicar
 * duas linhas da mesma marca por variação de maiúscula/acento.
 */
export function construirOperacoesMarcas(marcas: EvidenciaMarca[]): OperacaoMarca[] {
  const { marcasValidas } = avaliarMultimarcas(marcas);
  return marcasValidas.map((m) => ({
    marcaNormalizada: normalizarChave(m.marca),
    marca: m.marca,
    evidencia: m.evidencia,
    fonteUrl: m.fonteUrl,
    dataVerificacao: m.dataVerificacao,
    tipoEvidencia: m.tipoEvidencia,
    confianca: m.confianca,
  }));
}

export type ProspectQualificadoParaQuota = {
  id: string;
  estado: string | null;
  cidade: string | null;
  scoreComercial: number | null;
};

/**
 * Adapta prospects já qualificados (vindos do banco) pro formato que aplicarQuotaGeografica()
 * (quota-geografica.ts) espera. NÃO decide quem é aprovado — só traduz tipos; filtra silenciosamente
 * quem não tem estado ou score (candidato sem score é candidato que o gate não aprovou — nunca
 * recebe um score inventado de 0 só pra "participar" da cota). Ponto de extensão explícito pra uma
 * fase futura (a descoberta nacional real, NÃO executada aqui): quem chamar isto com o conjunto
 * completo de candidatos qualificados de uma rodada nacional pode então chamar
 * aplicarQuotaGeografica() sobre o resultado.
 */
export function prepararCandidatosParaQuota(prospects: ProspectQualificadoParaQuota[]): CandidatoParaQuota[] {
  return prospects
    .filter((p): p is ProspectQualificadoParaQuota & { estado: string; scoreComercial: number } =>
      Boolean(p.estado?.trim()) && typeof p.scoreComercial === "number")
    .map((p) => ({ id: p.id, uf: p.estado, municipio: p.cidade, score: p.scoreComercial }));
}
