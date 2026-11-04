import type { EvidenciaSite } from "./pesquisa-web";

export type SituacaoAvaliacaoComercial =
  | "PRONTA_PARA_REVISAO_HUMANA"
  | "EVIDENCIA_PARCIAL"
  | "SEM_EVIDENCIA_COMERCIAL"
  | "SITE_NAO_VALIDADO";

export type AvaliacaoComercial = {
  scoreEvidencia: number;
  situacao: SituacaoAvaliacaoComercial;
  identidade: "ALTA" | "MEDIA" | "BAIXA";
  modaMasculina: "EVIDENCIADA" | "NAO_ENCONTRADA";
  multimarcas: "EVIDENCIADA" | "INDICIO_POR_MARCAS" | "NAO_ENCONTRADA";
  marcasEncontradas: string[];
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
  const multimarcas = Boolean(ev?.sinaisMultimarcas.length);
  const marcas = [...new Set(ev?.marcas ?? [])];
  const identidade = input.confiancaIdentidade;
  const scoreEvidencia =
    (identidade === "ALTA" ? 20 : identidade === "MEDIA" ? 12 : 0) +
    (masculina ? 35 : 0) +
    (multimarcas ? 35 : 0) +
    (marcas.length >= 2 ? 10 : marcas.length === 1 ? 5 : 0);

  const pronta = identidade !== "BAIXA" && masculina && multimarcas;
  const algumaEvidencia = masculina || multimarcas || marcas.length > 0;
  const situacao: SituacaoAvaliacaoComercial = !ev
    ? "SITE_NAO_VALIDADO"
    : pronta
      ? "PRONTA_PARA_REVISAO_HUMANA"
      : algumaEvidencia
        ? "EVIDENCIA_PARCIAL"
        : "SEM_EVIDENCIA_COMERCIAL";

  const pendencias: string[] = [];
  if (identidade === "BAIXA") pendencias.push("confirmar se o site pertence à loja e à cidade informadas");
  if (!masculina) pendencias.push("confirmar atuação em moda masculina");
  if (!multimarcas) pendencias.push("confirmar venda de mais de uma marca");
  if (marcas.length > 0) pendencias.push("confirmar se as marcas citadas são efetivamente comercializadas pela loja");
  if (!input.situacaoCadastral) pendencias.push("consultar situação cadastral oficial na Receita Federal");
  else if (input.situacaoCadastral !== "ATIVA") pendencias.push(`revisar situação cadastral: ${input.situacaoCadastral}`);

  const cadastro = input.situacaoCadastral
    ? `Receita Federal: ${input.situacaoCadastral} (regularidade cadastral, não aderência comercial)`
    : "situação da Receita ainda não consultada";
  const explicacao = [
    `EVIDÊNCIA COMERCIAL ${situacao} · ${scoreEvidencia}/100`,
    `identidade do site: ${identidade}`,
    masculina ? `moda masculina: evidência textual (${ev?.sinaisModaMasculina.join(", ")})` : "moda masculina: não encontrada no conteúdo analisado",
    multimarcas ? `multimarcas: evidência textual (${ev?.sinaisMultimarcas.join(", ")})` : marcas.length >= 2 ? `marcas citadas (${marcas.join(", ")}), mas multimarcas não comprovado` : "multimarcas: não comprovado",
    marcas.length ? `marcas citadas: ${marcas.join(", ")}` : "marcas da lista de referência: nenhuma identificada",
    cadastro,
    pendencias.length ? `pendências: ${pendencias.join("; ")}` : "pendência: revisão humana obrigatória antes de qualificar",
    "Esta avaliação organiza evidências públicas; não aprova, atribui grupo A/B/C/D nem autoriza contato.",
  ].join(" | ");

  return {
    scoreEvidencia,
    situacao,
    identidade,
    modaMasculina: masculina ? "EVIDENCIADA" : "NAO_ENCONTRADA",
    multimarcas: multimarcas ? "EVIDENCIADA" : marcas.length >= 2 ? "INDICIO_POR_MARCAS" : "NAO_ENCONTRADA",
    marcasEncontradas: marcas,
    pendencias,
    explicacao,
  };
}
