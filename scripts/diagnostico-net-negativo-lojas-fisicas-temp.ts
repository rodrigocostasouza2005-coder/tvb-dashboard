/**
 * Diagnóstico temporário, SOMENTE LEITURA — investiga por que o gráfico "Comparativo entre
 * lojas (unidades líquidas)" da Visão Geral (getSalesByDayPerStore, src/lib/metrics/vendas.ts)
 * mostra líquido negativo pras lojas físicas (Leblon/Barra/Rio Sul) entre 2026-11-10 e hoje.
 *
 * Esse gráfico calcula líquido = Sale.quantidade (por dia+loja) − Return.quantidade (por
 * dia+loja), SEM join por dapicVendaId — diferente do bug já conhecido do canal cd-atacado
 * (Sale via /faturas x Return via /vendaspdv, sem chave compartilhada). Essas 3 lojas físicas
 * têm Sale E Return originadas do MESMO endpoint (/vendaspdv), então a hipótese aqui é outra:
 * devolução tardia de venda antiga (normal), devolução órfã (sem Sale correspondente em
 * NENHUMA data) ou duplicidade de linha de Return (bug de sync).
 *
 * Pra cada dia/loja com líquido negativo, cruza cada Return daquele dia com TODA a tabela Sale
 * da mesma loja (qualquer data) por (storeId, dapicVendaId) pra classificar.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FROM = new Date("2026-11-10T00:00:00Z");

function toDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const hoje = new Date();
  console.log(`Período: ${toDayKey(FROM)} até ${toDayKey(hoje)} (hora da execução do workflow)`);

  const stores = await prisma.store.findMany({
    where: {
      OR: [
        { name: { contains: "Leblon", mode: "insensitive" } },
        { name: { contains: "Barra", mode: "insensitive" } },
        { name: { contains: "Rio Sul", mode: "insensitive" } },
        { displayGroup: { contains: "Leblon", mode: "insensitive" } },
        { displayGroup: { contains: "Barra", mode: "insensitive" } },
        { displayGroup: { contains: "Rio Sul", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, displayGroup: true, sellsProducts: true },
  });
  console.log("Lojas encontradas:", JSON.stringify(stores, null, 2));
  if (stores.length === 0) {
    console.log("Nenhuma loja encontrada com esses nomes — abortando.");
    return;
  }

  const storeIds = stores.map((s) => s.id);
  const nameByStoreId = new Map(stores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const sales = await prisma.sale.findMany({
    where: { storeId: { in: storeIds }, status: { not: "Cancelada" }, saleDate: { gte: FROM, lte: hoje } },
    select: { storeId: true, saleDate: true, quantidade: true, dapicVendaId: true, cod: true, produto: true, tamanho: true },
  });
  const returns = await prisma.return.findMany({
    where: { storeId: { in: storeIds }, status: { not: "Cancelada" }, returnDate: { gte: FROM, lte: hoje } },
    select: { storeId: true, returnDate: true, quantidade: true, dapicVendaId: true, cod: true, produto: true, tamanho: true, valorTotal: true, itemIndex: true },
  });

  // Todas as vendas de cada loja (qualquer data) indexadas por dapicVendaId, pra checar se a
  // devolução "órfã no período" na verdade bate com uma venda fora da janela (tardia legítima).
  const allSalesByStore = await prisma.sale.findMany({
    where: { storeId: { in: storeIds } },
    select: { storeId: true, dapicVendaId: true, saleDate: true, cod: true, quantidade: true },
  });
  const saleByStoreVenda = new Map<string, { saleDate: Date; cod: string; quantidade: number }[]>();
  for (const s of allSalesByStore) {
    const key = `${s.storeId}::${s.dapicVendaId}`;
    const arr = saleByStoreVenda.get(key) ?? [];
    arr.push({ saleDate: s.saleDate, cod: s.cod, quantidade: s.quantidade });
    saleByStoreVenda.set(key, arr);
  }

  type DayBucket = { vendido: number; devolvido: number };
  const byDayStore = new Map<string, DayBucket>(); // key = `${day}::${storeId}`

  for (const s of sales) {
    const day = toDayKey(s.saleDate);
    const key = `${day}::${s.storeId}`;
    const cur = byDayStore.get(key) ?? { vendido: 0, devolvido: 0 };
    cur.vendido += s.quantidade;
    byDayStore.set(key, cur);
  }
  for (const r of returns) {
    const day = toDayKey(r.returnDate);
    const key = `${day}::${r.storeId}`;
    const cur = byDayStore.get(key) ?? { vendido: 0, devolvido: 0 };
    cur.devolvido += r.quantidade;
    byDayStore.set(key, cur);
  }

  console.log("\n=== Líquido por dia/loja ===");
  const negativos: { day: string; storeId: string }[] = [];
  const sortedKeys = [...byDayStore.keys()].sort();
  for (const key of sortedKeys) {
    const [day, storeId] = key.split("::");
    const b = byDayStore.get(key)!;
    const liquido = b.vendido - b.devolvido;
    const loja = nameByStoreId.get(storeId) ?? storeId;
    console.log(`${day} | ${loja} | vendido=${b.vendido} devolvido=${b.devolvido} liquido=${liquido}${liquido < 0 ? "  <<< NEGATIVO" : ""}`);
    if (liquido < 0) negativos.push({ day, storeId });
  }

  console.log(`\n=== ${negativos.length} dia(s)/loja negativos — detalhando devoluções ===`);
  // Checagem de duplicidade: mais de uma linha de Return com o mesmo (storeId, dapicVendaId, itemIndex)
  const returnKeyCount = new Map<string, number>();
  for (const r of returns) {
    const k = `${r.storeId}::${r.dapicVendaId}::${r.itemIndex}`;
    returnKeyCount.set(k, (returnKeyCount.get(k) ?? 0) + 1);
  }

  for (const { day, storeId } of negativos) {
    const loja = nameByStoreId.get(storeId) ?? storeId;
    console.log(`\n--- ${day} | ${loja} ---`);
    const returnsDoDia = returns.filter((r) => r.storeId === storeId && toDayKey(r.returnDate) === day);
    for (const r of returnsDoDia) {
      const vendaKey = `${r.storeId}::${r.dapicVendaId}`;
      const vendasCorrespondentes = saleByStoreVenda.get(vendaKey) ?? [];
      const dupKey = `${r.storeId}::${r.dapicVendaId}::${r.itemIndex}`;
      const duplicada = (returnKeyCount.get(dupKey) ?? 0) > 1;
      let classificacao: string;
      if (duplicada) {
        classificacao = "POSSÍVEL DUPLICATA (mais de 1 linha de Return com mesmo storeId+dapicVendaId+itemIndex)";
      } else if (vendasCorrespondentes.length === 0) {
        classificacao = "ÓRFÃ (nenhuma Sale com esse dapicVendaId nesta loja, em nenhuma data)";
      } else {
        const maisAntiga = vendasCorrespondentes.reduce((a, b) => (a.saleDate < b.saleDate ? a : b));
        const diasDesdeVenda = Math.round((r.returnDate.getTime() - maisAntiga.saleDate.getTime()) / 86400000);
        classificacao = `TARDIA LEGÍTIMA (Sale original em ${toDayKey(maisAntiga.saleDate)}, ${diasDesdeVenda} dia(s) antes da devolução)`;
      }
      console.log(
        `  dapicVendaId=${r.dapicVendaId} itemIndex=${r.itemIndex} cod=${r.cod} produto=${r.produto} tamanho=${r.tamanho} qtd=${r.quantidade} valor=${r.valorTotal} -> ${classificacao}`
      );
    }
  }

  console.log("\n=== Fim do diagnóstico ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
