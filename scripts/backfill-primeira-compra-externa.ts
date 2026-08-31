// Importação única da 1ª compra de cada cliente no site antigo (plataforma vnda, export
// "Pedidos back up_vnda.xlsx") — SÓ a data, sem produto/receita (decisão do Rodrigo em
// 2026-08-31: "vamos ignorar a questão de produto e só vamos ligar pro CRM"). Usada
// exclusivamente pra corrigir a classificação de "cliente novo" em metrics.ts
// (getPrimeiraCompraGlobalPorCliente), que sem isso marcava como "novo" quem só tinha voltado a
// comprar depois de anos como cliente antigo — confirmado cruzando por CPF: 226 clientes reais
// do vnda desde 2021-2023 apareciam como "novo" no dashboard.
//
// Match por CPF (campo "Documento" no vnda, "cpfCnpj" no ClienteCadastro) — só dígitos, ignora
// pontuação dos dois lados. Idempotente: só atualiza se a data do vnda for MAIS ANTIGA que o que
// já está gravado (LEAST), então pode rodar de novo sem risco.
//
// Espera o arquivo em C:\Users\Dell\Desktop\Power Bi - Dashboards\Pedidos back up_vnda.xlsx
// (caminho local, só existe nessa máquina).
//
// "xlsx" (SheetJS) tem vulnerabilidade conhecida sem correção (prototype pollution / ReDoS ao
// PARSEAR um arquivo malicioso) — mantida como devDependency só por causa desses scripts locais,
// nunca importada por src/. Só usar com arquivo de origem confiável (o próprio Rodrigo).
import { PrismaClient, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "path";

const prisma = new PrismaClient();
const filePath = path.join("C:", "Users", "Dell", "Desktop", "Power Bi - Dashboards", "Pedidos back up_vnda.xlsx");
const BATCH_SIZE = 500;

function parseDataBR(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
}

function onlyDigits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

async function main() {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base"], { header: 1, defval: null }) as unknown[][];
  const header = rows[0] as string[];
  const iTipo = header.indexOf("Tipo");
  const iStatus = header.indexOf("Status");
  const iDoc = header.indexOf("Documento");
  const iData = header.indexOf("Data");

  const primeiraPorCpf = new Map<string, Date>();
  for (const r of rows.slice(1)) {
    if (r[iTipo] !== "Produto" || r[iStatus] !== "Confirmado") continue;
    const cpf = onlyDigits(r[iDoc]);
    if (cpf.length < 8) continue;
    const d = parseDataBR(r[iData]);
    if (!d) continue;
    const cur = primeiraPorCpf.get(cpf);
    if (!cur || d < cur) primeiraPorCpf.set(cpf, d);
  }
  console.log(`CPFs distintos com compra confirmada no vnda: ${primeiraPorCpf.size}`);

  const entries = [...primeiraPorCpf.entries()];
  let atualizados = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const values = batch.map(([cpf, data]) => Prisma.sql`(${cpf}::text, ${data}::timestamp)`);
    const result = await prisma.$executeRaw`
      UPDATE "ClienteCadastro" AS c
      SET "primeiraCompraExterna" = LEAST(COALESCE(c."primeiraCompraExterna", v.data), v.data),
          "fonteExterna" = 'vnda'
      FROM (VALUES ${Prisma.join(values)}) AS v(cpf, data)
      WHERE regexp_replace(COALESCE(c."cpfCnpj", ''), '[^0-9]', '', 'g') = v.cpf
    `;
    atualizados += result;
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length} CPFs processados, ${atualizados} clientes atualizados...`);
  }

  console.log(`\n✓ ${atualizados} clientes (ClienteCadastro) com primeiraCompraExterna preenchida/atualizada.`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
