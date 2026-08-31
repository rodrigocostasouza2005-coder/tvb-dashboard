// Importação única dos pedidos do site antigo (plataforma vnda, export "Pedidos back
// up_vnda.xlsx") pra VendaHistoricaExterna — 1 linha por pedido (Tipo="Total" no export, que já
// é o valor final do pedido; não precisa somar frete/produto/desconto separado).
//
// Decisão do Rodrigo em 2026-08-31: quer que apareça de verdade em Retenção/Segmentação/receita
// da Visão Geral de Clientes — não só uma correção invisível de data (isso já tinha sido feito
// separadamente em backfill-primeira-compra-externa.ts). Só dado de cliente/pedido/valor — sem
// produto/grupo/tamanho de propósito (nomenclatura do vnda é genérica demais pra combinar com o
// DAPIC, misturaria os gráficos por produto).
//
// Espera o arquivo em C:\Users\Dell\Desktop\Power Bi - Dashboards\Pedidos back up_vnda.xlsx
// (caminho local, só existe nessa máquina). Idempotente: upsert por pedidoExterno (@@unique),
// pode rodar de novo sem duplicar.
import { PrismaClient, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "path";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();
const filePath = path.join("C:", "Users", "Dell", "Desktop", "Power Bi - Dashboards", "Pedidos back up_vnda.xlsx");
const BATCH_SIZE = 500;

function parseDataBR(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
}

async function main() {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base"], { header: 1, defval: null }) as unknown[][];
  const header = rows[0] as string[];
  const iTipo = header.indexOf("Tipo");
  const iStatus = header.indexOf("Status");
  const iPedido = header.indexOf("Nº pedido");
  const iNome = header.indexOf("Nome");
  const iDoc = header.indexOf("Documento");
  const iData = header.indexOf("Data");
  const iPreco = header.indexOf("Preço venda");

  type Pedido = { pedidoExterno: string; clienteNome: string; cpfCnpj: string | null; saleDate: Date; valorTotal: number };
  const pedidos: Pedido[] = [];
  for (const r of rows.slice(1)) {
    if (r[iTipo] !== "Total" || r[iStatus] !== "Confirmado") continue;
    const pedidoExterno = String(r[iPedido] ?? "").trim();
    const data = parseDataBR(r[iData]);
    const nome = String(r[iNome] ?? "").trim();
    if (!pedidoExterno || !data || !nome) continue;
    const valorTotal = typeof r[iPreco] === "number" ? r[iPreco] : Number(r[iPreco]) || 0;
    const doc = r[iDoc] ? String(r[iDoc]).trim() : null;
    pedidos.push({ pedidoExterno, clienteNome: nome, cpfCnpj: doc || null, saleDate: data, valorTotal });
  }
  console.log(`Pedidos (Total/Confirmado) a importar: ${pedidos.length}`);

  let total = 0;
  for (let i = 0; i < pedidos.length; i += BATCH_SIZE) {
    const batch = pedidos.slice(i, i + BATCH_SIZE);
    const values = batch.map(
      (p) =>
        Prisma.sql`(${randomUUID()}, ${p.clienteNome}, ${p.cpfCnpj}, ${p.pedidoExterno}, ${p.saleDate}::timestamp, ${p.valorTotal}::float, 'vnda')`
    );
    await prisma.$executeRaw`
      INSERT INTO "VendaHistoricaExterna" ("id", "clienteNome", "cpfCnpj", "pedidoExterno", "saleDate", "valorTotal", "fonte")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("pedidoExterno") DO UPDATE SET
        "clienteNome" = EXCLUDED."clienteNome",
        "cpfCnpj"     = EXCLUDED."cpfCnpj",
        "saleDate"    = EXCLUDED."saleDate",
        "valorTotal"  = EXCLUDED."valorTotal"
    `;
    total += batch.length;
    process.stdout.write(`\r  ${total}/${pedidos.length} pedidos gravados...`);
  }

  console.log(`\n✓ ${total} pedidos históricos do vnda gravados em VendaHistoricaExterna.`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
