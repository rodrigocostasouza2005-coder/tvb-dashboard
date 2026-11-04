#!/usr/bin/env node
/**
 * Importa CSV gerado por gerar-prospects-rj.py para AtacadoProspect.
 * Seguro por padrão: sem --apply apenas valida e mostra a prévia.
 * Requer DATABASE_URL configurada no ambiente e @prisma/client instalado.
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
function arg(name, fallback = undefined) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const file = arg("--arquivo");
const competencia = arg("--competencia");
const apply = args.includes("--apply");
const batchSize = Math.max(50, Math.min(1000, Number(arg("--lote", "300")) || 300));
if (!file || !competencia || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(competencia)) {
  console.error("Uso: npx tsx scripts/prospeccao/importar_receita_neon.ts --arquivo prospects.csv --competencia AAAA-MM [--apply] [--lote 300]");
  process.exit(2);
}

function parseCsvLine(line, delimiter = ";") {
  const cells = [];
  let value = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      cells.push(value.trim()); value = "";
    } else value += c;
  }
  cells.push(value.trim());
  return cells;
}
function headerKey(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
const lines = raw.split(/\r?\n/).filter((line) => line.trim());
if (lines.length < 2) throw new Error("CSV vazio ou sem registros.");
const delimiter = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
const headers = parseCsvLine(lines[0], delimiter).map(headerKey);
const idx = Object.fromEntries(["nomefantasia","razaosocial","cnpj","cidade","uf","telefone","email","site","cnaeprincipal","cn aedescricao","porte","evidenciaurl"].map(k => [k, headers.indexOf(k.replace(/ /g,""))]));
const required = ["nomefantasia","cnpj","uf"];
for (const key of required) if (idx[key] < 0) throw new Error("Coluna obrigatória ausente: " + key);
const records = new Map();
let invalidos = 0;
for (const line of lines.slice(1)) {
  const c = parseCsvLine(line, delimiter);
  const get = (key) => idx[key] >= 0 ? (c[idx[key]] || "").trim() : "";
  const cnpj = get("cnpj").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const nomeFantasia = get("nomefantasia").slice(0,160);
  const uf = get("uf").toUpperCase();
  if (!nomeFantasia || !/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj) || !/^[A-Z]{2}$/.test(uf)) { invalidos++; continue; }
  records.set(cnpj, {
    nomeFantasia,
    razaoSocial: get("razaosocial").slice(0,180) || null,
    cnpj,
    cidade: get("cidade").slice(0,100) || null,
    estado: uf,
    telefone: get("telefone").slice(0,40) || null,
    email: get("email").slice(0,180) || null,
    site: /^https?:\/\//i.test(get("site")) ? get("site").slice(0,500) : null,
    origem: "receita_federal_dados_abertos",
    evidenciaUrl: /^https?:\/\//i.test(get("evidenciaurl")) ? get("evidenciaurl").slice(0,1000) : "https://www.gov.br/receitafederal/dados",
    observacoes: `Competência cadastral: ${competencia}. CNAE principal: ${get("cnaeprincipal") || "não informado"}; ${get("cnaedescricao") || "descrição não informada"}; porte: ${get("porte") || "não informado"}. Importado da base pública; validar aderência comercial antes do contato.`,
  });
}
const data = [...records.values()];
console.log(JSON.stringify({arquivo:file, competencia, linhas:lines.length-1, candidatosValidos:data.length, invalidos, modo:apply?"APLICAR":"PREVIA", lote:batchSize}, null, 2));
if (!apply) {
  console.log("Prévia apenas. Para gravar no Neon, repita com --apply.");
  process.exit(0);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não está definida.");
const prisma = new PrismaClient();
try {
  let inserted = 0;
  for (let i = 0; i < data.length; i += batchSize) {
    const result = await prisma.atacadoProspect.createMany({
      data: data.slice(i, i + batchSize),
      skipDuplicates: true,
    });
    inserted += result.count;
    console.log(`Lote ${Math.floor(i / batchSize) + 1}: ${result.count} novos registros`);
  }
  console.log(JSON.stringify({inseridos:inserted, jaExistentesOuDuplicados:data.length-inserted, totalValidos:data.length}, null, 2));
} finally {
  await prisma.$disconnect();
}
