import type { EvidenciaSite } from "./pesquisa-web";

export type SituacaoAvaliacaoComercial =
  | "PRONTA_PARA_REVISAO_HUMANA"
  | "EVIDENCIA_PARCIAL"
  | "SEM_EVIDENCIA_COMERCIAL"
  | "SITE_NAO_VALIDADO"
  | "NAO_ADERENTE";

export type AvaliacaoComercial = {
  scoreEvidencia: number;
  situacao: SituacaoAvaliacaoComercial;
  identidade: "ALTA" | "MEDIA" | "BAIXA";
  modaMasculina: "EVIDENCIADA" | "NAO_ENCONTRADA";
  multimarcas: "EVIDENCIADA" | "INDICIO_POR_MARCAS" | "NAO_ENCONTRADA";
  marcasEncontradas: string[];
  motivosDesqualificacao: string[];
  pendencias: string[];
  explicacao: string;
};

export function avaliarEvidenciasComerciais(input: {
  nomeLoja: string;
  cidade: string | null;
  confiancaIdentidade: "ALTA" | "MEDIA" | "BAIXA";
  evidencia: EvidenciaSite | null;
  situacaoCadastral: string | null;
}): AvaliacaoComercial {
  const ev = input.evidencia;
  const masculina = Boolean(ev?.sinaisModaMasculina.length);
  const marcas = [...new Set(ev?.marcas ?? [])];
  const sinaisMulti = ev?.sinaisMultimarcas ?? [];
  // Uma palavra genérica ("marcas", "nossas marcas") não prova revenda multimarcas.
  const multimarcas = sinaisMulti.length > 0 && marcas.length >= 2;
  const exclusoes = [...new Set(ev?.sinaisExclusao ?? [])];
  const marcaPropria = (ev?.sinaisMarcaPropria?.length ?? 0) > 0;
  const sinaisFemininos = ev?.sinaisModaFeminina ?? [];
  const identidade = input.confiancaIdentidade;
  const motivosDesqualificacao: string[] = [];
  if (exclusoes.length) motivosDesqualificacao.push(`atividade/categoria incompatível identificada: ${exclusoes.join(", ")}`);
  if (marcaPropria) motivosDesqualificacao.push("indícios de produção, fabricação ou marca própria; o perfil exigido é revendedor de terceiros");
  if (sinaisFemininos.length && !masculina) motivosDesqualificacao.push("evidência de moda feminina sem evidência de linha masculina");

  const bloqueada = exclusoes.length > 0 || marcaPropria || (sinaisFemininos.length > 0 && !masculina);
  const scoreEvidencia = identidade === "BAIXA" || !ev || bloqueada ? 0 :
    (identidade === "ALTA" ? 20 : 12) +
    (masculina ? 35 : 0) +
    (multimarcas ? 35 : 0) +
    (marcas.length >= 2 ? 10 : marcas.length === 1 ? 5 : 0);
  const pronta = !bloqueada && identidade === "ALTA" && masculina && multimarcas;
  const algumaEvidencia = masculina || sinaisMulti.length > 0 || marcas.length > 0 || sinaisFemininos.length > 0 || marcaPropria;
  const situacao: SituacaoAvaliacaoComercial = !ev
    ? "SITE_NAO_VALIDADO"
    : bloqueada
      ? "NAO_ADERENTE"
      : pronta
        ? "PRONTA_PARA_REVISAO_HUMANA"
        : algumaEvidencia
          ? "EVIDENCIA_PARCIAL"
          : "SEM_EVIDENCIA_COMERCIAL";

  const pendencias: string[] = [];
  if (identidade !== "ALTA") pendencias.push("confirmar identidade do site e vínculo com a loja/cidade; somente confiança ALTA segue para revisão");
  if (!masculina) pendencias.push("não foi comprovada linha de moda masculina");
  if (!multimarcas) pendencias.push("não foram comprovadas duas ou mais marcas de terceiros comercializadas pela loja");
  if (sinaisFemininos.length && !masculina) pendencias.push("o conteúdo aponta para moda feminina, sem prova de linha masculina");
  if (!input.situacaoCadastral) pendencias.push("consultar situação cadastral oficial na Receita Federal");
  else if (input.situacaoCadastral !== "ATIVA") pendencias.push(`revisar situação cadastral: ${input.situacaoCadastral}`);

  const cadastro = input.situacaoCadastral
    ? `Receita Federal: ${input.situacaoCadastral} (regularidade cadastral, não aderência comercial)`
    : "situação da Receita ainda não consultada";
  const explicacao = [
    `EVIDÊNCIA COMERCIAL ${situacao} · ${scoreEvidencia}/100`,
    `identidade do site: ${identidade}`,
    masculina ? `moda masculina: evidência textual (${ev?.sinaisModaMasculina.join(", ")})` : "moda masculina: não comprovada",
    multimarcas ? `revenda multimarcas: sinal explícito (${sinaisMulti.join(", ")}) e marcas identificadas (${marcas.join(", ")})` : "revenda multimarcas: não comprovada; marcas citadas isoladamente não bastam",
    marcaPropria ? `sinais de produção/marca própria: ${ev?.sinaisMarcaPropria?.join(", ")}` : "sem sinal textual de fabricação própria",
    exclusoes.length ? `bloqueios: ${exclusoes.join(", ")}` : "nenhuma categoria incompatível detectada",
    sinaisFemininos.length ? `sinais de moda feminina: ${sinaisFemininos.join(", ")}` : "sem sinal específico de moda feminina",
    cadastro,
    motivosDesqualificacao.length ? `motivos de desqualificação: ${motivosDesqualificacao.join("; ")}` : "",
    pendencias.length ? `pendências: ${pendencias.join("; ")}` : "pendência: revisão humana obrigatória antes de qualificar",
    "Apenas candidatos com identidade, moda masculina e revenda multimarcas comprovadas seguem para revisão humana. Esta avaliação não aprova nem autoriza contato.",
  ].filter(Boolean).join(" | ");

  return {
    scoreEvidencia,
    situacao,
    identidade,
    modaMasculina: masculina ? "EVIDENCIADA" : "NAO_ENCONTRADA",
    multimarcas: multimarcas ? "EVIDENCIADA" : sinaisMulti.length || marcas.length >= 2 ? "INDICIO_POR_MARCAS" : "NAO_ENCONTRADA",
    marcasEncontradas: marcas,
    motivosDesqualificacao,
    pendencias,
    explicacao,
  };
}
