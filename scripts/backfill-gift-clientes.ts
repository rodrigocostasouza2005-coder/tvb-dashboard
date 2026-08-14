// Backfill de clienteNome nos registros Gift históricos — campo adicionado em 2026-08-14,
// todos os registros anteriores têm clienteNome = null.
// Estratégia: para cada loja, busca vendaspdv (e faturas, para CD) no range de datas dos gifts
// com null, constrói mapa dapicVendaId -> cliente, atualiza em batch.
// Idempotente: só atualiza registros com clienteNome null, pode ser rodado de novo sem problema.
// Uso: npx tsx scripts/backfill-gift-clientes.ts

import { PrismaClient } from "@prisma/client";
import { createDapicClients } from "../src/lib/connectors/dapic";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Mapa de código da loja para o label do cliente DAPIC
const STORE_CODE_TO_CLIENT: Record<string, string> = {
  CD: "cd-atacado",
  ATACADO: "cd-atacado",
  Leblon: "leblon",
  "Rio Sul": "rio-sul",
  Barra: "barra",
};

async function main() {
  const allClients = createDapicClients();
  const clientByLabel = new Map(allClients.map((c) => [c.label, c]));

  // 1. Busca todas as lojas com gifts sem clienteNome e seus ranges de data
  const giftsNull = await prisma.gift.groupBy({
    by: ["storeId"],
    where: { clienteNome: null },
    _count: { _all: true },
    _min: { giftDate: true },
    _max: { giftDate: true },
  });

  if (giftsNull.length === 0) {
    console.log("Nenhum gift sem clienteNome. Nada a fazer.");
    await prisma.$disconnect();
    return;
  }

  const storeIds = giftsNull.map((g) => g.storeId);
  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, code: true, name: true },
  });
  const storeById = new Map(stores.map((s) => [s.id, s]));

  let totalAtualizado = 0;

  for (const grupo of giftsNull) {
    const store = storeById.get(grupo.storeId);
    if (!store) continue;

    const clientLabel = STORE_CODE_TO_CLIENT[store.code];
    if (!clientLabel) {
      console.warn(`Loja ${store.code} sem mapeamento de cliente DAPIC — pulando.`);
      continue;
    }

    const client = clientByLabel.get(clientLabel);
    if (!client) {
      console.warn(`Cliente "${clientLabel}" não encontrado nas credenciais — pulando.`);
      continue;
    }

    const dataInicial = toDateStr(grupo._min.giftDate!);
    const dataFinal = toDateStr(grupo._max.giftDate!);
    const total = grupo._count._all;

    console.log(`\n[${store.name}] ${total} gifts (${dataInicial} → ${dataFinal})`);

    // Mapa vendaId -> cliente para esta loja
    const clienteByVendaId = new Map<number, string | null>();

    // vendaspdv — todas as lojas (inclusive cd-atacado tem brindes via PDV)
    console.log(`  Buscando vendaspdv...`);
    const vendas = await client.fetchVendasPdv(dataInicial, dataFinal);
    for (const v of vendas) {
      if (v.Cliente) clienteByVendaId.set(v.Id, v.Cliente);
    }
    console.log(`  ${vendas.length} vendas carregadas, ${clienteByVendaId.size} com cliente.`);

    // faturas — só para cd-atacado (brindes de nota fiscal)
    if (clientLabel === "cd-atacado") {
      console.log(`  Buscando faturas (cd-atacado)...`);
      const faturas = await client.fetchFaturas(dataInicial, dataFinal);
      for (const f of faturas) {
        if (f.Cliente) clienteByVendaId.set(f.Id, f.Cliente);
      }
      console.log(`  ${faturas.length} faturas carregadas.`);
    }

    // 2. Busca os gifts dessa loja com clienteNome null
    const gifts = await prisma.gift.findMany({
      where: { storeId: store.id, clienteNome: null },
      select: { id: true, dapicVendaId: true },
    });

    // 3. Atualiza em batch (uma query por clienteNome distinto)
    const byCliente = new Map<string, string[]>();
    let semCliente = 0;
    for (const g of gifts) {
      const nome = clienteByVendaId.get(g.dapicVendaId) ?? null;
      if (!nome) { semCliente++; continue; }
      const list = byCliente.get(nome) ?? [];
      list.push(g.id);
      byCliente.set(nome, list);
    }

    for (const [nome, ids] of byCliente) {
      await prisma.gift.updateMany({
        where: { id: { in: ids } },
        data: { clienteNome: nome },
      });
      totalAtualizado += ids.length;
    }

    console.log(`  Atualizados: ${totalAtualizado} | Sem cliente na API: ${semCliente}`);
  }

  console.log(`\n✓ Total atualizado: ${totalAtualizado} gifts.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
