// Backfill: vendas do Site+Atacado (CD + ATACADO) com tabelaPreco=null onde o preço pago não bateu
// com nenhuma tabela do catálogo, mas o cliente já tem histórico confirmado de "Tabela atacado".
// Mesma regra agora aplicada em tempo real pelo sync (ver inferTabelaPrecoComFallbackCliente em
// sync-runner.ts) — aqui só aplica retroativamente aos registros que já existiam antes do fix
// (2026-09-30, pedido do Rodrigo: "quero que mexa no passado").
import { prisma } from "@/lib/prisma";
import { getB2BClienteNomes, getSiteAtacadoStoreIds } from "@/lib/metrics";

async function main() {
  const storeIds = await getSiteAtacadoStoreIds();
  const b2bClientes = [...(await getB2BClienteNomes())];
  console.log(`Lojas Site+Atacado: ${storeIds.join(", ")}`);
  console.log(`Clientes já confirmados como atacado: ${b2bClientes.length}`);

  const antes = await prisma.sale.count({
    where: { storeId: { in: storeIds }, tabelaPreco: null, clienteNome: { in: b2bClientes } },
  });
  console.log(`Vendas null que vão virar "Tabela atacado": ${antes}`);

  const result = await prisma.sale.updateMany({
    where: { storeId: { in: storeIds }, tabelaPreco: null, clienteNome: { in: b2bClientes } },
    data: { tabelaPreco: "Tabela atacado" },
  });
  console.log(`Atualizadas: ${result.count}`);

  const depois = await prisma.sale.count({
    where: { storeId: { in: storeIds }, tabelaPreco: null },
  });
  console.log(`Nulls restantes no Site+Atacado (sem cliente confirmado): ${depois}`);
}

main().finally(() => prisma.$disconnect());
