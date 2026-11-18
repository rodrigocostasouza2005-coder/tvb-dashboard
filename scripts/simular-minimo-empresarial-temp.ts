/**
 * Simulação SOMENTE LEITURA, temporária — Etapa 8 do pedido do Rodrigo (2026-11-18): dimensionar
 * com dado real quantos Best Sellers existem hoje, como o estoque consolidado por tamanho se
 * distribui, e ilustrar (com mínimos HIPOTÉTICOS, claramente identificados) como a funcionalidade
 * de "estoque mínimo empresarial" proposta se comportaria. NÃO existe ainda nenhum mínimo
 * cadastrado (a funcionalidade não foi implementada) — nenhum número de mínimo aqui é real.
 *
 * NÃO escreve nada. Uso: npx tsx scripts/simular-minimo-empresarial-temp.ts
 */
import { getComparacaoCompleta } from "@/lib/metrics";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("=== Simulação de estoque mínimo empresarial (somente leitura, produção) ===\n");

  const bestSellers = await prisma.classificacaoProduto.findMany({
    where: { tipoCompra: "BEST_SELLER" },
    select: { cod: true, produto: true, grupo: true },
  });
  console.log(`Cods classificados como BEST_SELLER hoje: ${bestSellers.length}`);
  const produtosUnicos = [...new Set(bestSellers.map((b) => b.produto))];
  console.log(`Produtos distintos: ${produtosUnicos.length} (${produtosUnicos.join(", ")})\n`);

  if (bestSellers.length === 0) {
    console.log("Nenhum Best Seller classificado hoje — não há o que simular com dado real.");
    return;
  }

  const codsBestSeller = new Set(bestSellers.map((b) => b.cod));
  const { variantes } = await getComparacaoCompleta();
  const variantesBestSeller = variantes.filter((v) => codsBestSeller.has(v.cod));

  for (const produto of produtosUnicos) {
    console.log(`\n--- ${produto} ---`);
    const vs = variantesBestSeller.filter((v) => v.produto === produto);
    const porTamanho = new Map<string, number>();
    for (const v of vs) {
      const estoqueConsolidado = v.porLoja.reduce((s, l) => s + l.estoqueAtual, 0);
      porTamanho.set(v.tamanho ?? "(sem tamanho)", (porTamanho.get(v.tamanho ?? "(sem tamanho)") ?? 0) + estoqueConsolidado);
    }
    const linhas = [...porTamanho.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true }));
    const total = linhas.reduce((s, [, qtd]) => s + qtd, 0);
    console.log(`  Total consolidado (todos os tamanhos, todas as posições): ${total} un.`);
    console.log("  Por tamanho:");
    for (const [tamanho, qtd] of linhas) console.log(`    ${tamanho}: ${qtd} un.`);

    const max = Math.max(...linhas.map(([, q]) => q));
    const min = Math.min(...linhas.map(([, q]) => q));
    if (max > 0 && min / max < 0.3 && linhas.length > 1) {
      console.log(`  ATENÇÃO (desequilíbrio real, sem mínimo definido): tamanho mais fraco (${min} un.) é menos de 30% do mais forte (${max} un.) — total alto não garante que todos os tamanhos estão bem.`);
    }

    if (produto === produtosUnicos[0] && linhas.length > 0) {
      console.log("\n  Exemplo ILUSTRATIVO de como a tela ficaria (mínimo HIPOTÉTICO, não é recomendação real):");
      for (const [tamanho, qtd] of linhas) {
        const minimoHipotetico = Math.round(total / linhas.length / 2); // só pra ilustrar, metade da média — NÃO é fórmula proposta
        const status = qtd < minimoHipotetico ? "CRÍTICO (hipotético)" : qtd < minimoHipotetico * 1.3 ? "ATENÇÃO (hipotético)" : "Normal (hipotético)";
        console.log(`    tamanho ${tamanho}: mínimo hipotético=${minimoHipotetico} | estoque=${qtd} | status=${status}`);
      }
    }
  }

  console.log("\n=== Fim da simulação ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
