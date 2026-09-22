// Backfill único (2026-09-21): preenche Sale.codigo (campo novo) pras vendas RECENTES já
// sincronizadas antes desse campo existir — sem isso, o Follow-up pós-compra (janela de 7-10
// dias) ficaria sem código de venda até essas linhas saírem naturalmente da janela (~10 dias).
// Janela de 21 dias dá folga de sobra. Não mexe em histórico mais antigo — dali pra frente o
// sync normal (syncVendas/syncFaturas) já grava o campo sozinho.
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { createDapicClients } from "../src/lib/connectors/dapic";
import { syncArmazenadores } from "../src/lib/sync-runner";

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// 1 UPDATE em lote (batch) em vez de 1 por venda — achado rodando a 1ª versão deste script:
// centenas de updateMany() em sequência (1 round-trip cada) deixava a conexão idle tempo
// suficiente pro Neon derrubar no meio (P1017, mesmo erro já documentado em outros backfills
// desse projeto). Lote de 200 por vez, com CASE/WHEN — poucas idas ao banco.
async function atualizarEmLote(storeId: string, pares: [number, string][]) {
  const BATCH = 200;
  let total = 0;
  for (let i = 0; i < pares.length; i += BATCH) {
    const lote = pares.slice(i, i + BATCH);
    const ids = lote.map(([id]) => id);
    const whenClauses = lote.map(([id, codigo]) => Prisma.sql`WHEN ${id} THEN ${codigo}`);
    const result = await prisma.$executeRaw`
      UPDATE "Sale"
      SET codigo = CASE "dapicVendaId" ${Prisma.join(whenClauses, " ")} END
      WHERE "storeId" = ${storeId} AND "dapicVendaId" IN (${Prisma.join(ids)}) AND codigo IS NULL
    `;
    total += result;
  }
  return total;
}

async function main() {
  const clients = createDapicClients();
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - 21);
  const hoje = new Date();

  let totalAtualizado = 0;
  for (const client of clients) {
    if (client.label === "matriz") continue; // não vende, não tem venda pra atualizar
    const { primaryStoreId } = await syncArmazenadores(client);
    if (!primaryStoreId) continue;

    const codigoPorVendaId = new Map<number, string>();
    if (client.label === "cd-atacado") {
      const faturas = await client.fetchFaturas(toDateStr(inicio), toDateStr(hoje));
      for (const f of faturas) codigoPorVendaId.set(f.Id, f.Codigo);
    } else {
      const vendas = await client.fetchVendasPdv(toDateStr(inicio), toDateStr(hoje));
      for (const v of vendas) codigoPorVendaId.set(v.Id, v.Codigo);
    }
    console.log(`${client.label}: ${codigoPorVendaId.size} vendas/faturas na janela`);

    const pares = [...codigoPorVendaId.entries()] as [number, string][];
    const atualizadasNestaLoja = pares.length > 0 ? await atualizarEmLote(primaryStoreId, pares) : 0;
    console.log(`${client.label}: ${atualizadasNestaLoja} linhas de Sale atualizadas com código`);
    totalAtualizado += atualizadasNestaLoja;
  }
  console.log(`Total geral atualizado: ${totalAtualizado}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
