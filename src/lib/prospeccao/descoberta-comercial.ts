import type { PerfilAprendido } from "./aprendizado-comercial";
import type { EvidenciaSite, ResultadoBusca } from "./pesquisa-web";

const STOP = new Set(["loja","lojas","moda","roupa","roupas","masculina","masculino","multimarcas","multi","marcas","comercio","varejo","ltda","me","epp","evidencia","publica","validar","pendente","informado","informada","de","da","do","e"]);

function termosPerfil(perfil: PerfilAprendido): string[] {
  const raw = [perfil.atributos.segmentoComercial, perfil.atributos.perfilLoja, perfil.atributos.faixaPreco]
    .filter((v): v is string => !!v)
    .flatMap((v) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/));
  return [...new Set(raw.filter((v) => v.length > 2 && !STOP.has(v) && !/^evidencia_/.test(v)))].slice(0, 4);
}

/** Consultas derivadas de perfis reais; sem amostra, usa somente uma busca-base conservadora. */
export function gerarConsultasDescoberta(perfis: PerfilAprendido[], uf: string, limite = 8, cidade?: string): string[] {
  const sigla = uf.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(sigla)) throw new Error("UF inválida");
  const municipio = cidade?.trim().replace(/\s+/g, " ").slice(0, 100);
  const local = municipio ? `"${municipio}" ${sigla}` : sigla;
  const base = `loja "moda masculina" multimarcas ${local}`;
  const consultas = perfis.slice(0, 5).map((perfil) => {
    const termos = termosPerfil(perfil);
    return termos.length ? `loja "moda masculina" multimarcas ${termos.map((x) => `"${x}"`).join(" ")} ${local}` : base;
  });
  consultas.push(base, `"roupas masculinas" "multimarcas" loja ${local}`);
  return [...new Set(consultas)].slice(0, Math.max(1, Math.min(12, limite)));
}

export type CandidatoDescoberto = {
  nomeResultado: string;
  url: string;
  dominio: string;
  trechoBusca: string;
  sinaisMasculino: string[];
  sinaisMultimarcas: string[];
  marcasEncontradas: string[];
  pontuacaoEvidencia: number;
  classificacao: "CANDIDATO_PARA_REVISAO";
  perfilReferencia: string;
};

export function avaliarCandidatoDescoberto(
  resultado: ResultadoBusca,
  evidencia: EvidenciaSite,
  perfilReferencia: string,
): CandidatoDescoberto | null {
  let dominio: string;
  try {
    const u = new URL(evidencia.url);
    dominio = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!["http:", "https:"].includes(u.protocol)) return null;
  } catch { return null; }
  const masculino = evidencia.sinaisModaMasculina;\n  const nomeLoja = `${resultado.titulo} ${evidencia.titulo}`.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();\n  const nomeSegmento = /\\b(surf|surfwear|surf\\s*shop|skate|skateshop|streetwear|boardshop)\\b/.test(nomeLoja);
  const multi = evidencia.sinaisMultimarcas;
  const marcas = evidencia.marcas;
  const exclusoes = evidencia.sinaisExclusao ?? [];
  const marcaPropria = (evidencia.sinaisMarcaPropria?.length ?? 0) > 0;
  // Exige moda masculina + prova explícita de revenda + pelo menos duas marcas identificadas.
  if (exclusoes.length || (evidencia.sinaisModaFeminina?.length && !masculino.length)) return null;\n  // O nome público da loja também precisa apontar para surf/skate; segmento citado só no rodapé não basta.\n  if (!nomeSegmento) return null;
  if (marcaPropria) return null;
  if (!masculino.length || !multi.length || marcas.length < 2) return null;
  const score = Math.min(100, 60 + Math.min(25, marcas.length * 8) + (nomeSegmento ? 10 : 0) + (evidencia.descricao ? 5 : 0));
  return {
    nomeResultado: resultado.titulo || dominio,
    url: evidencia.url,
    dominio,
    trechoBusca: resultado.trecho.slice(0, 500),
    sinaisMasculino: masculino,
    sinaisMultimarcas: multi,
    marcasEncontradas: marcas,
    pontuacaoEvidencia: score,
    classificacao: "CANDIDATO_PARA_REVISAO",
    perfilReferencia,
  };
}

export function gerarCsvDescoberta(candidatos: CandidatoDescoberto[]): string {
  const columns: (keyof CandidatoDescoberto)[] = ["nomeResultado","url","dominio","trechoBusca","sinaisMasculino","sinaisMultimarcas","marcasEncontradas","pontuacaoEvidencia","classificacao","perfilReferencia"];
  const cell = (v: unknown) => {
    const raw = Array.isArray(v) ? v.join("; ") : String(v ?? "");
    return `"${raw.replace(/"/g, '""')}"`;
  };
  return [columns.join(","), ...candidatos.map((c) => columns.map((k) => cell(c[k])).join(","))].join("\n");
}
