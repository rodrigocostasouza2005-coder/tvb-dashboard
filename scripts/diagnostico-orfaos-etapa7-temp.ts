/**
 * Diagnostico temporario, SOMENTE LEITURA (zero update/create/delete) — Etapa 7: re-extrai os
 * registros reais de Return sem Sale correspondente, canal cd-atacado. Mesma logica da Etapa 6.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const stores = await prisma.store.findMany({ select: { id: true, name: true, displayGroup: true } });
  const cdAtacadoStoreIds = stores.filter((s) => (s.displayGroup ?? s.name) === "TVB Site e Atacado").map((s) => s.id);
  console.log(`storeIds do canal "TVB Site e Atacado": ${JSON.stringify(cdAtacadoStoreIds)}`);

  const returns = await prisma.return.findMany({
    where: { status: { not: "Cancelada" }, dapicVendaId: { not: null } },
    select: { id: true, storeId: true, dapicVendaId: true, cod: true, produto: true, tamanho: true, quantidade: true, valorTotal: true, returnDate: true },
  });
  console.log(`Total Return (nao cancelada, dapicVendaId preenchido): ${returns.length}`);

  const vendaIds = [...new Set(returns.map((r) => r.dapicVendaId as number))];
  const sales = await prisma.sale.findMany({
    where: { dapicVendaId: { in: vendaIds } },
    select: { dapicVendaId: true },
    distinct: ["dapicVendaId"],
  });
  const vendaIdsComSale = new Set(sales.map((s) => s.dapicVendaId));

  const orfaos = returns.filter((r) => !vendaIdsComSale.has(r.dapicVendaId as number));
  const orfaosCdAtacado = orfaos.filter((r) => cdAtacadoStoreIds.includes(r.storeId));
  const orfaosOutraLoja = orfaos.filter((r) => !cdAtacadoStoreIds.includes(r.storeId));
  console.log(`\nTotal de linhas orfas: ${orfaos.length}`);
  console.log(`Orfaos no canal cd-atacado: ${orfaosCdAtacado.length}`);
  console.log(`Orfaos em outras lojas: ${orfaosOutraLoja.length}`);

  const vendaIdsDistintosCdAtacado = [...new Set(orfaosCdAtacado.map((r) => r.dapicVendaId as number))];
  console.log(`Pedidos (dapicVendaId) distintos orfaos no cd-atacado: ${vendaIdsDistintosCdAtacado.length}`);

  console.log("\n=== DADOS COMPLETOS (1 JSON por linha, prefixo ROW| ) ===");
  for (const r of orfaosCdAtacado) {
    console.log("ROW|" + JSON.stringify({
      dapicVendaId: r.dapicVendaId,
      storeId: r.storeId,
      cod: r.cod,
      produto: r.produto,
      tamanho: r.tamanho,
      quantidade: r.quantidade,
      valorTotal: r.valorTotal,
      returnDate: r.returnDate.toISOString(),
    }));
  }
  console.log(`=== FIM DADOS (${orfaosCdAtacado.length} linhas) ===`);
  console.log("\n(Diagnostico concluido — somente leitura, nenhum registro foi alterado.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
