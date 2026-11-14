/**
 * Verificação temporária, SOMENTE LEITURA — pós-fix do PR #97 (marca=null não pode sumir do
 * lado Sale ao netar contra Return). Chama a função REAL (getSalesByDayPerStore, importada
 * direto de src/lib/metrics/vendas.ts — não reimplementa a query) com o filtro de marca/
 * tabelaPreco REAL de um usuário real, contra o banco de produção, pro dia 10/11/2026 (o mesmo
 * dia do print original do Rodrigo que mostrou Barra -6 / Leblon -1 / Rio Sul -2).
 *
 * Objetivo: confirmar que a correção já mergeada (main 229731a) de fato produz líquido correto
 * contra o dado de produção de agora — não reimplementação paralela, a função de verdade.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Diagnóstico adicional (Rodrigo reportou valor IDÊNTICO ao de antes do fix, mesmo com refresh
  // forçado) — hipótese revista: a venda excluída pode ter marca REAL diferente das 5 permitidas
  // (não null), caso em que o fix de "OR marca IS NULL" não teria efeito nenhum. Confere os
  // valores reais de marca/tabelaPreco de TODA venda de Barra/Leblon/Rio Sul em 10/11, antes de
  // checar o resultado da função.
  const stores = await prisma.store.findMany({
    where: { name: { in: ["TVB Barra", "TVB Leblon", "TVB Rio Sul"] } },
    select: { id: true, name: true },
  });
  const storeIds = stores.map((s) => s.id);
  const breakdown = await prisma.sale.groupBy({
    by: ["storeId", "marca", "tabelaPreco"],
    where: {
      storeId: { in: storeIds },
      status: { not: "Cancelada" },
      saleDate: { gte: new Date("2026-11-10T00:00:00.000-03:00"), lte: new Date("2026-11-10T23:59:59.999-03:00") },
    },
    _sum: { quantidade: true },
  });
  const nameById = new Map(stores.map((s) => [s.id, s.name]));
  console.log("=== Breakdown real de marca/tabelaPreco das vendas de Barra/Leblon/Rio Sul em 10/11 ===");
  for (const r of breakdown) {
    console.log(`${nameById.get(r.storeId)} | marca=${JSON.stringify(r.marca)} tabelaPreco=${JSON.stringify(r.tabelaPreco)} unidades=${r._sum.quantidade}`);
  }
  console.log("");

  const user = await prisma.user.findFirst({
    where: { email: "rodrigo@tvbshorts.com" },
    select: { allowedMarcas: true, allowedTabelasPreco: true },
  });
  if (!user) {
    console.log("Usuário rodrigo@tvbshorts.com não encontrado — abortando.");
    return;
  }
  const marcas = user.allowedMarcas;
  const tabelasPreco = user.allowedTabelasPreco.filter((t) => t !== "Tabela atacado");
  console.log(`Filtro real do usuário: marcas=${JSON.stringify(marcas)} tabelasPreco=${JSON.stringify(tabelasPreco)}`);

  const filters = {
    from: new Date("2026-11-10T00:00:00.000-03:00"),
    to: new Date("2026-11-10T23:59:59.999-03:00"),
    storeIds: undefined,
    marcas,
    tabelasPreco,
    grupoIn: undefined,
    colecaoIn: undefined,
  };

  const { getSalesByDayPerStore } = await import("../src/lib/metrics/vendas");
  const result = await getSalesByDayPerStore(filters);
  console.log("Resultado de getSalesByDayPerStore (função real, pós-fix) para 10/11/2026:");
  console.log(JSON.stringify(result, null, 2));

  const dia = result.data.find((d) => d.day === "2026-11-10");
  if (!dia) {
    console.log("Nenhum dado pro dia 10/11 — pode ser que o dia tenha ficado 100% zerado agora (sem venda nem devolução), não necessariamente um problema.");
    return;
  }
  for (const [loja, valor] of Object.entries(dia)) {
    if (loja === "day") continue;
    console.log(`${loja}: ${valor}${typeof valor === "number" && valor < 0 ? "  <<< AINDA NEGATIVO" : ""}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
