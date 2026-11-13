/**
 * Diagnostico temporario, SOMENTE LEITURA (zero update/create/delete) — Etapa 6: extrai os
 * registros reais de Return sem Sale correspondente (em nenhuma loja/status), concentrados no
 * canal cd-atacado (displayGroup "TVB Site e Atacado"). Imprime dapicVendaId/storeId/cod/
 * produto/tamanho/quantidade/valorTotal/returnDate — SEM nome/CPF/telefone de cliente (essa
 * tabela nem guarda isso; cliente só existe no DAPIC).
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
  console.log(`\nTotal de linhas orfas (dapicVendaId sem Sale em NENHUMA loja): ${orfaos.length}`);

  const orfaosCdAtacado = orfaos.filter((r) => cdAtacadoStoreIds.includes(r.storeId));
  const orfaosOutraLoja = orfaos.filter((r) => !cdAtacadoStoreIds.includes(r.storeId));
  console.log(`Orfaos no canal cd-atacado: ${orfaosCdAtacado.length}`);
  console.log(`Orfaos em outras lojas: ${orfaosOutraLoja.length}`);
  if (orfaosOutraLoja.length > 0) {
    console.log("Detalhe orfaos outras lojas:");
    for (const r of orfaosOutraLoja) {
      console.log(`  storeId=${r.storeId} dapicVendaId=${r.dapicVendaId} valor=${r.valorTotal} returnDate=${r.returnDate.toISOString().slice(0,10)}`);
    }
  }

  const vendaIdsDistintosCdAtacado = [...new Set(orfaosCdAtacado.map((r) => r.dapicVendaId as number))];
  console.log(`\nPedidos (dapicVendaId) distintos orfaos no cd-atacado: ${vendaIdsDistintosCdAtacado.length}`);

  const datas = orfaosCdAtacado.map((r) => r.returnDate.getTime());
  console.log(`Faixa de returnDate: ${new Date(Math.min(...datas)).toISOString().slice(0,10)} a ${new Date(Math.max(...datas)).toISOString().slice(0,10)}`);

  console.log("\n=== DADOS COMPLETOS (JSON, para processamento — sem nome/cliente, so campos de Return) ===");
  console.log(JSON.stringify(orfaosCdAtacado.map((r) => ({
    dapicVendaId: r.dapicVendaId,
    storeId: r.storeId,
    cod: r.cod,
    produto: r.produto,
    tamanho: r.tamanho,
    quantidade: r.quantidade,
    valorTotal: r.valorTotal,
    returnDate: r.returnDate.toISOString(),
  }))));

  console.log("\n(Diagnostico concluido — somente leitura, nenhum registro foi alterado.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
