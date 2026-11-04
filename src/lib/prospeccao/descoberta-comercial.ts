import type { PerfilAprendido } from "./aprendizado-comercial";
import type { EvidenciaSite, ResultadoBusca } from "./pesquisa-web";

const STOP = new Set(["loja","lojas","moda","roupa","roupas","masculina","masculino","multimarcas","multi","marcas","comercio","varejo","ltda","me","epp","de","da","do","e"]);

function termosPerfil(perfil: PerfilAprendido): string[] {
  const raw = [perfil.atributos.segmentoComercial, perfil.atributos.perfilLoja, perfil.atributos.faixaPreco]
    .filter((v): v is string => !!v)
    .flatMap((v) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/));
  return [...new Set(raw.filter((v) => v.length > 2 && !STOP.has(v) && !/^evidencia_/.test(v)))].slice(0, 4);
}

/** Consultas derivadas de perfis reais; sem amostra, usa somente uma busca-base conservadora. */
export function gerarConsultasDescoberta(perfis: PerfilAprendido[], uf: string, limite = 8): string[] {
  const sigla = uf.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(sigla)) throw new Error("UF inválida");
  const base = `loja "moda masculina" multimarcas ${sigla}`;
  const consultas = perfis.slice(0, 5).map((perfil) => {
    const termos = termosPerfil(perfil);
    return termos.length ? `loja "moda masculina" multimarcas ${termos.map((x) => `"${x}"`).join(" ")} ${sigla}` : base;
  });
  consultas.push(base, `"roupas masculinas" "multimarcas" loja ${sigla}`);
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
  const masculino = evidencia.sinaisModaMasculina;
  const multi = evidencia.sinaisMultimarcas;
  const marcas = evidencia.marcas;
  // Não basta CNAE, título ou menção genérica a moda: exige evidência textual no site.
  if (!masculino.length || (!multi.length && marcas.length < 2)) return null;
  const score = Math.min(100, 30 + Math.min(35, multi.length * 20) + Math.min(30, marcas.length * 10) + (evidencia.titulo ? 5 : 0));
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
