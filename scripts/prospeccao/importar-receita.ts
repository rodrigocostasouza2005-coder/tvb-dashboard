#!/usr/bin/env node
/**
 * Importa o CSV produzido por gerar-prospects-rj.py para AtacadoProspect.
 *
 * Seguro por padrão: sem --apply apenas valida e apresenta a prévia.
 * Duplicados por CNPJ são ignorados; nenhum cadastro existente é atualizado.
 *
 * Uso:
 *   npx tsx scripts/prospeccao/importar-receita.ts --arquivo dados/prospects.csv --competencia 2026-10
 *   npx tsx scripts/prospeccao/importar-receita.ts --arquivo dados/prospects.csv --competencia 2026-10 --apply
 */
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

type ProspectRow = {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  cidade: string;
  codigo_municipio: string;
  uf: string;
  telefone: string;
  email: string;
  site: string;
  cnae_principal: string;
  cnae_correspondente: string;
  tipo_correspondencia: string;
  cnae_descricao: string;
  porte: string;
  origem: string;
  evidencia_url: string;
  competencia: string;
};

function parseCsvLine(line: string, delimiter = ";"): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(value);
      value = "";
    } else value += char;
  }
  if (quoted) throw new Error("CSV contém campo com aspas não fechadas.");
  cells.push(value);
  return cells;
}

function parseCsv(raw: string): ProspectRow[] {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV vazio ou sem linhas de dados.");
  const delimiter = (lines[0].match(/;/g) ?? []).length >= (lines[0].match(/,/g) ?? []).length ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.trim().toLowerCase());
  const required = ["nome_fantasia", "cnpj", "uf"];
  for (const field of required) if (!headers.includes(field)) throw new Error(`Coluna obrigatória ausente: ${field}`);
  const index = (name: string) => headers.indexOf(name);
  return lines.slice(1).map((line, lineIndex) => {
    const cells = parseCsvLine(line, delimiter);
    const get = (name: string) => {
      const i = index(name);
      return i < 0 ? "" : (cells[i] ?? "").trim();
    };
    const row: ProspectRow = {
      nome_fantasia: get("nome_fantasia"),
      razao_social: get("razao_social"),
      cnpj: get("cnpj").toUpperCase().replace(/[^A-Z0-9]/g, ""),
      cidade: get("cidade"),
      codigo_municipio: get("codigo_municipio"),
      uf: get("uf").toUpperCase(),
      telefone: get("telefone"),
      email: get("email").toLowerCase(),
      site: get("site"),
      cnae_principal: get("cnae_principal"),
      cnae_correspondente: get("cnae_correspondente"),
      tipo_correspondencia: get("tipo_correspondencia").toUpperCase(),
      cnae_descricao: get("cnae_descricao"),
      porte: get("porte"),
      origem: get("origem"),
      evidencia_url: get("evidencia_url"),
      competencia: get("competencia"),
    };
    if (!row.nome_fantasia || !/^[A-Z]{2}$/.test(row.uf) || !/^[A-Z0-9]{12}[0-9]{2}$/.test(row.cnpj)) {
      throw new Error(`Linha ${lineIndex + 2}: nome, CNPJ ou UF inválido.`);
    }
    return row;
  });
}

function safeUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : "";
  };
  const file = arg("--arquivo");
  const competence = arg("--competencia");
  const apply = args.includes("--apply");
  const municipalitiesFile = arg("--municipios");
  if (!file || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(competence)) {
    throw new Error("Uso: --arquivo <csv> --competencia AAAA-MM [--apply]");
  }

  const rows = parseCsv(await readFile(file, "utf8"));
  const municipalityLines = municipalitiesFile
    ? (await readFile(municipalitiesFile, "utf8")).replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1)
    : [];
  const municipalityMap = new Map<string, string>();
  for (const line of municipalityLines) {
    const [code, ...nameParts] = parseCsvLine(line);
    const name = nameParts.join(";").trim();
    if (code && name) municipalityMap.set(code.trim().padStart(4, "0"), name);
  }
  const unique = new Map<string, ProspectRow>();
  for (const row of rows) if (!unique.has(row.cnpj)) unique.set(row.cnpj, row);
  const deduped = [...unique.values()];
  console.log(`Arquivo: ${file}`);
  console.log(`Competência informada: ${competence}`);
  console.log(`Linhas válidas: ${rows.length} | CNPJs únicos: ${deduped.length} | duplicados no arquivo: ${rows.length - deduped.length}`);
  if (!apply) {
    console.log("PRÉVIA: nenhum dado foi gravado. Revise o arquivo e execute novamente com --apply.");
    return;
  }

  const prisma = new PrismaClient();
  try {
    let inserted = 0;
    let citiesNormalized = 0;
    // Não apresentar razão social (que pode ser nome de pessoa) como nome da loja.
    const namesHidden = await prisma.$executeRaw`
      UPDATE "AtacadoProspect"
      SET "nomeFantasia" = 'NOME COMERCIAL NÃO IDENTIFICADO'
      WHERE "origem" = 'receita_federal_dados_abertos'
        AND "estado" = ${arg("--uf").toUpperCase()}
        AND "nomeFantasia" = "razaoSocial"
        AND "razaoSocial" IS NOT NULL
    `;
    console.log(`Nomes comerciais pendentes de pesquisa: ${namesHidden}`);
    // Corrige códigos TOM já importados para nomes de municípios, sem alterar UF/CNPJ.
    for (const [code, name] of municipalityMap) {
      const result = await prisma.atacadoProspect.updateMany({
        where: { estado: arg("--uf").toUpperCase(), cidade: code },
        data: { cidade: name, codigoMunicipio: code },
      });
      citiesNormalized += result.count;
    }
    console.log(`Municípios normalizados na UF ${arg("--uf") || "não informada"}: ${citiesNormalized}`);
    for (let offset = 0; offset < deduped.length; offset += 400) {
      const batch = deduped.slice(offset, offset + 400);
      const existing = await prisma.atacadoProspect.findMany({
        where: { cnpj: { in: batch.map((row) => row.cnpj) } },
        select: { cnpj: true },
      });
      const existingCnpjs = new Set(existing.map((row) => row.cnpj));
      const novos = batch.filter((row) => !existingCnpjs.has(row.cnpj));
      if (novos.length === 0) continue;
      const result = await prisma.atacadoProspect.createMany({
        data: novos.map((row) => ({
          nomeFantasia: row.nome_fantasia.slice(0, 160),
          razaoSocial: row.razao_social.slice(0, 180) || null,
          cnpj: row.cnpj,
          cidade: row.cidade.slice(0, 100) || null,
          codigoMunicipio: row.codigo_municipio.slice(0, 10) || null,
          estado: row.uf,
          telefone: row.telefone.slice(0, 40) || null,
          email: row.email.slice(0, 180) || null,
          site: safeUrl(row.site),
          origem: "receita_federal_dados_abertos",
          origemAgente: "AGENTE_CAPTACAO_RECEITA_V1",
          evidenciaUrl: safeUrl(row.evidencia_url),
          observacoes: [
            `Coleta cadastral Receita Federal — competência ${competence}`,
            row.cnae_principal ? `CNAE principal: ${row.cnae_principal}` : "",
            row.cnae_correspondente ? `CNAE de moda identificado: ${row.cnae_correspondente}` : "",
            row.tipo_correspondencia === "PRINCIPAL" ? "Correspondência CNAE: atividade principal" : "Correspondência CNAE: atividade secundária — validar aderência comercial",
            row.cnae_descricao,
            row.porte ? `Porte cadastral: ${row.porte}` : "",
            row.nome_fantasia === "NOME COMERCIAL NÃO IDENTIFICADO" ? "Nome fantasia ausente na Receita; razão social mantida separadamente e nome comercial pendente de pesquisa." : "",
            "Grupo comercial pendente de pesquisa; CNAE não é suficiente para classificar A/B/C/D.",
            "Lead cadastral não verificado comercialmente.",
          ].filter(Boolean).join(" | "),
        })),
        skipDuplicates: true,
      });
      inserted += result.count;
      const insertedRows = await prisma.atacadoProspect.findMany({
        where: { cnpj: { in: novos.map((row) => row.cnpj) } },
        select: { id: true, cnpj: true },
      });
      await prisma.atacadoProspectActivity.createMany({
        data: insertedRows.map((row) => ({
          prospectId: row.id,
          tipo: "AGENTE_CAPTACAO",
          etapa: "CAPTACAO_RECEITA",
          descricao: "Candidato captado da base pública da Receita Federal. Aguardando triagem cadastral e validação comercial.",
          criadoPor: "AGENTE_CAPTACAO_RECEITA_V1",
        })),
      });
      console.log(`Lote ${Math.floor(offset / 400) + 1}: ${result.count} novos registros`);
    }
    console.log(`Concluído: ${inserted} inseridos; ${deduped.length - inserted} já existiam e foram preservados.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Falha na importação:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
