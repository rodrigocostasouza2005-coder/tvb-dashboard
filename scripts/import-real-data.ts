// Importa o histórico real exportado do DAPIC (arquivos que o Rodrigo já usava pro Power BI).
// Os arquivos NÃO ficam no repo — lidos direto da pasta original no Desktop.
// Uso: npm run db:import-real -- "C:\Users\Dell\Desktop\Power Bi - Dashboards"

import path from "path";
import XLSX from "xlsx";
import { PrismaClient, type Prisma } from "@prisma/client";

// Usa a conexão direta (sem pgbouncer) pra esse script em lote — o pooler recicla/derruba
// conexões ociosas de forma mais agressiva, o que é ótimo pra requests de app mas ruim
// pra um script que fica minutos parseando um xlsx antes da próxima query.
const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

const sourceDir = process.argv[2] ?? "C:\\Users\\Dell\\Desktop\\Power Bi - Dashboards";

// Excel guarda datas como número serial (dias desde 1899-12-30).
function excelSerialToDate(serial: unknown): Date | null {
  if (typeof serial !== "number") return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStringOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" || s === "(vazio)" ? null : s;
}

// O Neon derruba conexões ociosas (ex: depois de minutos parseando um xlsx grande em JS
// antes da próxima query) — tenta de novo com reconexão explícita antes de desistir.
async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await prisma.$disconnect();
      const waitMs = Math.min(2000 * 2 ** i, 30000);
      console.log(`  (conexão falhou, tentando de novo em ${waitMs / 1000}s...)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

async function getStoreIdByName(cache: Map<string, string>, fantasiaOrCode: string): Promise<string | null> {
  if (cache.has(fantasiaOrCode)) return cache.get(fantasiaOrCode)!;
  const store = await withRetry(() =>
    prisma.store.findFirst({
      where: { OR: [{ name: fantasiaOrCode }, { code: fantasiaOrCode }] },
    })
  );
  if (!store) return null;
  cache.set(fantasiaOrCode, store.id);
  return store.id;
}

function readSheet(file: string, sheetName?: string) {
  const wb = XLSX.readFile(path.join(sourceDir, file));
  const sheet = wb.Sheets[sheetName ?? wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
}

async function importSales() {
  await prisma.$disconnect();
  const rows = readSheet("VENDAS_PARA_BI.xlsx", "VENDAS");
  const storeCache = new Map<string, string>();
  let imported = 0;
  let skipped = 0;

  const data: Prisma.SaleCreateManyInput[] = [];
  for (const row of rows) {
    const storeId = await getStoreIdByName(storeCache, String(row["Fantasia (Empresa)"] ?? ""));
    const saleDate = excelSerialToDate(row["Data da venda"]);
    if (!storeId || !saleDate) {
      skipped++;
      continue;
    }
    data.push({
      storeId,
      cod: String(row["cod"] ?? ""),
      produto: String(row["Produto"] ?? ""),
      grupo: String(row["Grupo de produto"] ?? ""),
      cor: toStringOrNull(row["Cor"]),
      tamanho: toStringOrNull(row["Tamanho"]),
      marca: toStringOrNull(row["Marca"]),
      clienteNome: toStringOrNull(row["Razão social (Cliente)"]),
      vendedor: toStringOrNull(row["Vendedor"]),
      tabelaPreco: toStringOrNull(row["Tabela de preço"]),
      cidade: toStringOrNull(row["Cidade"]),
      estado: toStringOrNull(row["Estado"]),
      quantidade: Math.round(toNumber(row["Quantidade"])),
      valorTotalLiquido: toNumber(row["Valor total líquido"]),
      valorCustoTotal: toNumber(row["Valor de custo total"]),
      valorFrete: toNumber(row["Valor de frete"]),
      saleDate,
    });
    imported++;
  }

  const BATCH = 2000;
  for (let i = 0; i < data.length; i += BATCH) {
    await withRetry(() => prisma.sale.createMany({ data: data.slice(i, i + BATCH) }));
  }
  console.log(`Vendas: ${imported} importadas, ${skipped} ignoradas (loja/data inválida).`);
  return { imported, skipped };
}

async function importStock() {
  await prisma.$disconnect();
  const rows = readSheet("ESTOQUE_POWER_BI.xlsx", "ESTOQUE");
  const storeCache = new Map<string, string>();
  let imported = 0;
  let skipped = 0;
  const data: Prisma.StockSnapshotCreateManyInput[] = [];

  for (const row of rows) {
    const storeId = await getStoreIdByName(storeCache, String(row["Armazenador"] ?? row["Empresa"] ?? ""));
    if (!storeId) {
      skipped++;
      continue;
    }
    data.push({
      storeId,
      cod: String(row["Código de barras interno"] ?? ""),
      produto: String(row["Nome do produto"] ?? ""),
      grupo: String(row["Grupo (produto acabado)"] ?? ""),
      cor: toStringOrNull(row["Cor"]),
      tamanho: toStringOrNull(row["Tamanho"]),
      colecao: toStringOrNull(row["Coleção (produto acabado)"]),
      quantidadeDisponivel: Math.round(toNumber(row["Quantidade total disponível"])),
      estoqueMinimo: row["Estoque mínimo"] != null ? Math.round(toNumber(row["Estoque mínimo"])) : null,
    });
    imported++;
  }

  const BATCH = 2000;
  for (let i = 0; i < data.length; i += BATCH) {
    await withRetry(() => prisma.stockSnapshot.createMany({ data: data.slice(i, i + BATCH) }));
  }
  console.log(`Estoque: ${imported} snapshots importados, ${skipped} ignorados.`);
  return { imported, skipped };
}

async function importReturns() {
  await prisma.$disconnect();
  const rows = readSheet("DEVOLUÇÃO_BI.xlsx", "DEVOLUÇÃO ");
  const storeCache = new Map<string, string>();
  let imported = 0;
  let skipped = 0;
  const data: Prisma.ReturnCreateManyInput[] = [];

  for (const row of rows) {
    const storeId = await getStoreIdByName(storeCache, String(row["Armazenador"] ?? ""));
    const returnDate = excelSerialToDate(row["Data da devolução"]);
    if (!storeId || !returnDate) {
      skipped++;
      continue;
    }
    data.push({
      storeId,
      cod: String(row["Cod"] ?? row["COD"] ?? ""),
      produto: String(row["Produto"] ?? ""),
      grupo: String(row["Grupo de produto"] ?? ""),
      cor: toStringOrNull(row["Cor"]),
      tamanho: toStringOrNull(row["Tamanho"]),
      quantidade: Math.round(toNumber(row["Quantidade"])),
      valorTotal: toNumber(row["Valor total"]),
      returnDate,
    });
    imported++;
  }

  const BATCH = 2000;
  for (let i = 0; i < data.length; i += BATCH) {
    await withRetry(() => prisma.return.createMany({ data: data.slice(i, i + BATCH) }));
  }
  console.log(`Devoluções: ${imported} importadas, ${skipped} ignoradas.`);
  return { imported, skipped };
}

async function importProductionOrders() {
  await prisma.$disconnect();
  const rows = readSheet("ORDEM_PRODUÇAO.xlsx", "ORDEM DE PRODUÇÃO");
  let imported = 0;
  const data: Prisma.ProductionOrderCreateManyInput[] = [];

  for (const row of rows) {
    data.push({
      grupo: String(row["Grupo de produto acabado"] ?? ""),
      referencia: toStringOrNull(row["Referência"]),
      produto: String(row["Produto"] ?? ""),
      tamanho: toStringOrNull(row["Tamanho"]),
      quantidadeFinalizada: Math.round(toNumber(row["Quantidade finalizada"])),
      dataPrevisao: excelSerialToDate(row["Data de previsão"]),
      ordemProducao: String(row["Ordem de produção"] ?? ""),
      cod: toStringOrNull(row["COD"]),
    });
    imported++;
  }

  const BATCH = 2000;
  for (let i = 0; i < data.length; i += BATCH) {
    await withRetry(() => prisma.productionOrder.createMany({ data: data.slice(i, i + BATCH) }));
  }
  console.log(`Ordens de produção: ${imported} importadas.`);
  return { imported };
}

async function main() {
  console.log(`Lendo arquivos de: ${sourceDir}`);

  // Roda limpo a cada execução (esse script é o bootstrap histórico, não a sync contínua).
  await prisma.return.deleteMany({});
  await prisma.productionOrder.deleteMany({});
  await prisma.sale.deleteMany({});
  await prisma.stockSnapshot.deleteMany({});
  await prisma.syncLog.deleteMany({});

  const sales = await importSales();
  await prisma.syncLog.create({
    data: { source: "SALES", status: "SUCCESS", recordsSynced: sales.imported, message: "Import histórico inicial (xlsx)", finishedAt: new Date() },
  });

  const stock = await importStock();
  await prisma.syncLog.create({
    data: { source: "STOCK", status: "SUCCESS", recordsSynced: stock.imported, message: "Import histórico inicial (xlsx)", finishedAt: new Date() },
  });

  const returns = await importReturns();
  await prisma.syncLog.create({
    data: { source: "RETURNS", status: "SUCCESS", recordsSynced: returns.imported, message: "Import histórico inicial (xlsx)", finishedAt: new Date() },
  });

  const production = await importProductionOrders();
  await prisma.syncLog.create({
    data: { source: "PRODUCTION", status: "SUCCESS", recordsSynced: production.imported, message: "Import histórico inicial (xlsx)", finishedAt: new Date() },
  });

  console.log("Import concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
