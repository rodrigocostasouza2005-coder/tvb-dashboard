// Só leitura. Testa a hipótese do Rodrigo: pedido de NITHI/PROS de 30/09 foi cancelado e
// recriado, e as duas versões (a cancelada antiga + a nova) ficaram contadas juntas no banco.
import { createDapicClients, stableItemIndexes } from "@/lib/connectors/dapic";
import { prisma } from "@/lib/prisma";

async function main() {
  const clients = createDapicClients();
  const cdAtacado = clients.find((c) => c.label === "cd-atacado");
  if (!cdAtacado) return console.log("token cd-atacado não encontrado");

  const faturas = await cdAtacado.fetchFaturas("2026-09-28", "2026-10-01");
  const nithiPros = faturas.filter((f) => f.Cliente?.toUpperCase().includes("NITHI") || f.Cliente?.toUpperCase().includes("PROS"));
  console.log("Faturas NITHI/PROS na API (28/09 a 01/10):");
  for (const f of nithiPros) {
    console.log(`  Id=${f.Id} Codigo=${f.Codigo} Status=${f.Status} Cliente=${f.Cliente} DataFechamento=${f.DataFechamento} ValorLiquido=${f.ValorLiquido}`);
  }

  for (const f of nithiPros) {
    const produtos = await cdAtacado.fetchFaturaProdutos(f.Id);
    console.log(`\n=== Fatura Id=${f.Id} (${f.Cliente}) — ${produtos.length} itens na API (fetchFaturaProdutos) ===`);
    const itemIndexes = stableItemIndexes(
      produtos,
      (p) => `${p.IdGradeProduto}::${p.Quantidade}::${p.Valores.ValorTotal.toFixed(2)}::${p.Tipo}`
    );
    const seen = new Map<number, number>();
    for (const ix of itemIndexes) seen.set(ix, (seen.get(ix) ?? 0) + 1);
    const colisoes = [...seen.entries()].filter(([, count]) => count > 1);
    console.log(`  itemIndexes únicos: ${seen.size} / ${produtos.length} itens — colisões: ${colisoes.length}`);
    if (colisoes.length) console.log("  COLISÕES:", colisoes);

    const rows = await prisma.sale.findMany({
      where: { dapicVendaId: f.Id },
      select: { itemIndex: true, cod: true, quantidade: true, valorTotalLiquido: true },
      orderBy: { itemIndex: "asc" },
    });
    console.log(`  linhas no banco: ${rows.length}`);
    const byItemIndex = new Map<number, typeof rows>();
    for (const r of rows) {
      const arr = byItemIndex.get(r.itemIndex) ?? [];
      arr.push(r);
      byItemIndex.set(r.itemIndex, arr);
    }
    const dupNoBanco = [...byItemIndex.entries()].filter(([, arr]) => arr.length > 1);
    console.log(`  itemIndex duplicado NO BANCO: ${dupNoBanco.length}`);
    for (const [ix, arr] of dupNoBanco.slice(0, 5)) {
      console.log(`    itemIndex=${ix}:`, arr);
    }
  }
}

main().finally(() => prisma.$disconnect());
