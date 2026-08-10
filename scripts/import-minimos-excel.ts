// Importação única dos mínimos de estoque do Power BI antigo (ESTOQUE_POWER_BI.xlsx, abas
// "ESTOQUE MÍNIMO - LEBLON_BARRA" e "ESTOQUE MÍNIMO - RIO SUL") pra popular StockMinimumRule
// de uma vez, em vez de digitar tudo manualmente na tela de Estoque Mínimo. Pedido do Rodrigo
// em 2026-08-10, só pra destravar a aba de Reposição logo. Rodado uma vez: 1275 regras criadas.
//
// As duas abas são uma matriz Grupo x Tamanho, com uma coluna por Coleção. Os nomes de coleção
// no Excel não batem exatamente com os nomes reais no banco (espaço/maiúscula diferente) —
// mapeados abaixo. Sem essa correção as regras nunca dariam match em nada.
//
// Espera o arquivo em C:\Users\Dell\Desktop\Power Bi - Dashboards\ESTOQUE_POWER_BI.xlsx
// (caminho local, só existe nessa máquina).
//
// "xlsx" (SheetJS) tem vulnerabilidade conhecida sem correção (prototype pollution / ReDoS ao
// PARSEAR um arquivo malicioso — GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9). Mantida como
// devDependency só por causa desse script (nunca importada por src/, não roda em produção).
// Só usar com arquivo .xlsx de origem confiável (o próprio Rodrigo, nunca upload de terceiro).
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "path";

const prisma = new PrismaClient();
const filePath = path.join("C:", "Users", "Dell", "Desktop", "Power Bi - Dashboards", "ESTOQUE_POWER_BI.xlsx");

// coluna do Excel -> nome real da coleção no banco
const LEBLON_BARRA_COLECOES: Record<string, string> = {
  "V26.1": "V26.1",
  "Drop1 Inverno.26": "Drop1 Inverno.26",
  "Drop 2 inverno.26": "Drop 2 Inverno 26",
  BESTSELLER: "BESTSELLER",
};
const RIO_SUL_COLECOES: Record<string, string> = {
  "V26.1": "V26.1",
  "Drop 1 Inverno.26": "Drop1 Inverno.26",
  "Drop 2 inverno.26": "Drop 2 Inverno 26",
  BESTSELLER: "BESTSELLER",
};

async function importSheet(sheetName: string, colecoes: Record<string, string>, storeNames: string[]) {
  const wb = XLSX.readFile(filePath);
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });

  const stores = await prisma.store.findMany({ where: { name: { in: storeNames } } });
  if (stores.length !== storeNames.length) {
    throw new Error(`Loja(s) não encontrada(s): esperado ${storeNames.join(", ")}, achei ${stores.map((s) => s.name).join(", ")}`);
  }

  let criadas = 0;
  let atualizadas = 0;
  let ignoradas = 0;

  for (const row of rows) {
    const grupo = String(row["Grupo (produto acabado)"] ?? "").trim();
    const tamanho = String(row["Tamanho"] ?? "").trim();
    if (!grupo || !tamanho) continue;

    for (const [colunaExcel, colecaoReal] of Object.entries(colecoes)) {
      const raw = row[colunaExcel];
      const valorMinimo = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(valorMinimo) || valorMinimo <= 0) {
        ignoradas++;
        continue;
      }

      for (const store of stores) {
        const existing = await prisma.stockMinimumRule.findFirst({
          where: { storeId: store.id, grupo, tamanho, colecao: colecaoReal },
        });
        if (existing) {
          await prisma.stockMinimumRule.update({ where: { id: existing.id }, data: { valorMinimo } });
          atualizadas++;
        } else {
          await prisma.stockMinimumRule.create({
            data: { storeId: store.id, grupo, tamanho, colecao: colecaoReal, valorMinimo },
          });
          criadas++;
        }
      }
    }
  }

  console.log(`${sheetName}: ${criadas} criadas, ${atualizadas} atualizadas, ${ignoradas} ignoradas (zero/vazio)`);
}

async function main() {
  await importSheet("ESTOQUE MÍNIMO - LEBLON_BARRA", LEBLON_BARRA_COLECOES, ["TVB Leblon", "TVB Barra"]);
  await importSheet("ESTOQUE MÍNIMO - RIO SUL", RIO_SUL_COLECOES, ["TVB Rio Sul"]);
  const total = await prisma.stockMinimumRule.count();
  console.log("Total de regras no banco agora:", total);
}
main().finally(() => prisma.$disconnect());
