// Backfill único: corrige retroativamente vendas ja canceladas no DAPIC que nunca foram
// reconciliadas (a reconciliação normal do sync só olha os últimos RECONCILIACAO_DIAS=7 dias).
// Mesma mecânica de reconciliarCancelamentosVendas/Faturas, só com janela igual ao histórico
// completo (2024-01-01) pra pegar cancelamento antigo também. Idempotente (só atualiza linha com
// status != Cancelada), seguro rodar de novo. Uso: npx tsx scripts/backfill-cancelamentos.ts
import { createDapicClients } from "@/lib/connectors/dapic";
import { syncArmazenadores, reconciliarCancelamentosVendas, reconciliarCancelamentosFaturas } from "@/lib/sync-runner";
import { prisma } from "@/lib/prisma";

const DIAS_HISTORICO_COMPLETO = Math.ceil((Date.now() - new Date("2024-01-01").getTime()) / 86_400_000);

async function main() {
  const clients = createDapicClients().filter((c) => c.label !== "matriz");
  let totalSale = 0, totalReturn = 0;
  for (const client of clients) {
    const { primaryStoreId, atacadoStoreId } = await syncArmazenadores(client);
    const vendas = await reconciliarCancelamentosVendas(client, primaryStoreId, atacadoStoreId, DIAS_HISTORICO_COMPLETO);
    const faturas = await reconciliarCancelamentosFaturas(client, primaryStoreId, atacadoStoreId, DIAS_HISTORICO_COMPLETO);
    console.log(`[${client.label}] vendas: ${JSON.stringify(vendas)} faturas: ${JSON.stringify(faturas)}`);
    totalSale += vendas.saleUpdates + faturas.saleUpdates;
    totalReturn += vendas.returnUpdates;
  }
  console.log(`\nTotal Sale marcadas Cancelada: ${totalSale}`);
  console.log(`Total Return marcadas Cancelada: ${totalReturn}`);
}
main().finally(() => prisma.$disconnect());
