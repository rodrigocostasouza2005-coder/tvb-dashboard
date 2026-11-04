#!/usr/bin/env node
/**
 * Descobre candidatos novos a partir de padrões reais do Bruce.
 * Somente leitura do Neon. Resultados são arquivos de revisão, nunca leads inseridos no Radar.
 * Não acessa redes sociais; visita apenas sites cujo robots.txt permite.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isIP } from "node:net";
import { PrismaClient } from "@prisma/client";
import { aprenderPerfis } from "../../src/lib/prospeccao/aprendizado-comercial";
import { avaliarCandidatoDescoberto, gerarConsultasDescoberta, gerarCsvDescoberta, type CandidatoDescoberto } from "../../src/lib/prospeccao/descoberta-comercial";
import { extrairEvidenciasSite, extrairResultadosBusca, hostEhRedeSocial } from "../../src/lib/prospeccao/pesquisa-web";

const prisma = new PrismaClient();
const UA = "TVB-Radar-Discovery/1.0";
const TIMEOUT = 7000;
const MAX_SITE_CHECKS = 80;

async function html(url: string): Promise<{ body: string; finalUrl: string } | null> {
  try {
    const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(TIMEOUT), redirect: "follow" });
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") ?? "")) return null;
    return { body: (await response.text()).slice(0, 1_500_000), finalUrl: response.url };
  } catch { return null; }
}

function isSafePublicSite(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || isIP(host) || !host.includes(".")) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) return false;
    return true;
  } catch { return false; }
}

async function robotsAllows(url: string): Promise<boolean> {
  if (!isSafePublicSite(url)) return false;
  try {
    const target = new URL(url);
    const response = await fetch(`${target.origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT), redirect: "error" });
    if (response.status === 404) return true;
    if (!response.ok) return false;
    const lines = (await response.text()).split(/\r?\n/);
    let applies = false;
    for (const raw of lines) {
      const line = raw.replace(/#.*$/, "").trim();
      const [key, ...rest] = line.split(":");
      if (!key || !rest.length) continue;
      const value = rest.join(":").trim();
      if (key.toLowerCase() === "user-agent") applies = value === "*" || value.toLowerCase().includes("tvb-radar");
      if (key.toLowerCase() === "disallow" && applies && value && (target.pathname === value || target.pathname.startsWith(value))) return false;
    }
    return true;
  } catch { return false; }
}

async function search(query: string) {
  const page = await html(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  return page ? extrairResultadosBusca(page.body).slice(0, 12) : [];
}

async function main() {
  if (process.argv.includes("--apply")) throw new Error("Este agente é somente leitura; não aceita --apply.");
  const arg = (key: string, fallback: string) => { const i = process.argv.indexOf(key); return i >= 0 ? process.argv[i + 1] ?? fallback : fallback; };
  const uf = arg("--uf", "RJ").toUpperCase();
  const cidade = arg("--cidade", "").trim().replace(/\\s+/g, " ").slice(0, 100);
  const maxQueries = Math.max(1, Math.min(12, Number(arg("--max-queries", "8")) || 8));
  const maxCandidates = Math.max(1, Math.min(100, Number(arg("--max-candidates", "40")) || 40));
  if (!/^[A-Z]{2}$/.test(uf)) throw new Error("UF inválida.");

  const activities = await prisma.atacadoProspectActivity.findMany({
    where: { tipo: "INTERACAO_BRUCE", resultado: { not: null } },
    orderBy: { createdAt: "desc" }, take: 5000,
    select: { prospectId: true, resultado: true, prospect: { select: { segmentoComercial: true, perfilLoja: true, faixaPreco: true, estado: true, status: true } } },
  });
  const profiles = aprenderPerfis(activities.map((a) => ({
    prospectId: a.prospectId,
    resultado: a.resultado as "INTERESSADO" | "SEM_RESPOSTA" | "RECUSOU" | "PEDIU_CATALOGO" | "PEDIU_PRECO" | "NEGOCIANDO" | "PEDIDO_REALIZADO" | "RECOMPRA" | "SEM_ADERENCIA" | "DADOS_INVALIDOS" | "OUTRO" | null,
    segmentoComercial: a.prospect.segmentoComercial, perfilLoja: a.prospect.perfilLoja,
    faixaPreco: a.prospect.faixaPreco, estado: a.prospect.estado, status: a.prospect.status,
  })));
  const profilesForUf = profiles.filter((p) => !p.atributos.estado || p.atributos.estado === uf);
  const queries = gerarConsultasDescoberta(profilesForUf, uf, maxQueries, cidade || undefined);
  console.log(`RADAR DESCOBERTA | UF=${uf} | CIDADE=${cidade || "TODAS"} | perfis aprendidos=${profilesForUf.length} | consultas=${queries.length} | modo=ARQUIVOS PARA REVISÃO (somente leitura)`);

  const byDomain = new Map<string, CandidatoDescoberto>();
  let siteChecks = 0;
  for (let i = 0; i < queries.length && byDomain.size < maxCandidates && siteChecks < MAX_SITE_CHECKS; i++) {
    const query = queries[i];
    const results = await search(query);
    console.log(`Busca ${i + 1}/${queries.length}: ${query} | resultados=${results.length}`);
    for (const result of results) {
      if (byDomain.size >= maxCandidates || hostEhRedeSocial(result.url)) continue;
      let domain: string;
      try { domain = new URL(result.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; }
      if (byDomain.has(domain) || !isSafePublicSite(result.url)) continue;
      siteChecks++;
      if (!await robotsAllows(result.url)) continue;
      const page = await html(result.url);
      if (!page || hostEhRedeSocial(page.finalUrl)) continue;
      const evidence = extrairEvidenciasSite(page.finalUrl, page.body);
      const profileReference = query;
      const candidate = avaliarCandidatoDescoberto(result, evidence, profileReference);
      if (candidate) byDomain.set(candidate.dominio, candidate);
    }
  }

  const candidates = [...byDomain.values()].sort((a, b) => b.pontuacaoEvidencia - a.pontuacaoEvidencia);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), "artifacts", "prospeccao-descoberta");
  await mkdir(outDir, { recursive: true });
  const csvPath = join(outDir, `candidatos-${uf}${cidade ? "-" + cidade.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase() : ""}-${stamp}.csv`);
  const jsonPath = join(outDir, `candidatos-${uf}${cidade ? "-" + cidade.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase() : ""}-${stamp}.json`);
  await writeFile(csvPath, gerarCsvDescoberta(candidates), "utf8");
  await writeFile(jsonPath, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), uf, city: cidade || null, profilesUsed: profilesForUf.length, queries, candidates }, null, 2), "utf8");
  console.log(`Sites verificados: ${siteChecks}/${MAX_SITE_CHECKS}`);

  console.log(`Candidatos com evidência textual: ${candidates.length}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`JSON: ${jsonPath}`);
  console.log("Nenhum prospecto foi criado, atualizado, atribuído ou contatado. Revisão humana obrigatória.");
}

main().catch((error) => { console.error("Falha na descoberta:", error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
