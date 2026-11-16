/**
 * Verificação temporária, SOMENTE LEITURA — chama a função real getProdutosPlanejamento() (Fase
 * 1 do Planejamento de Estoque, importada direto de src/lib/metrics/planejamento-estoque.ts, não
 * reimplementada) contra produção, pra confirmar que não quebra com dado real e que os números
 * fazem sentido antes do PR ser revisado.
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const { getProdutosPlanejamento } = await import("../src/lib/metrics/planejamento-estoque");
  const produtos = await getProdutosPlanejamento();

  console.log(`Total de produtos retornados: ${produtos.length}`);

  const porSituacao = new Map<string, number>();
  for (const p of produtos) porSituacao.set(p.situacao, (porSituacao.get(p.situacao) ?? 0) + 1);
  console.log("Por situação:", JSON.stringify(Object.fromEntries(porSituacao), null, 2));

  const porClassificacao = new Map<string, number>();
  for (const p of produtos) porClassificacao.set(p.classificacao, (porClassificacao.get(p.classificacao) ?? 0) + 1);
  console.log("Por classificação:", JSON.stringify(Object.fromEntries(porClassificacao), null, 2));

  const negativos = produtos.filter((p) => p.estoqueTotal < 0 || p.estoqueCD < 0 || p.estoqueLojas < 0 || p.vendasDias30 < 0);
  console.log(`Produtos com estoque/venda negativo (não deveria existir): ${negativos.length}`);
  if (negativos.length > 0) console.log(JSON.stringify(negativos.slice(0, 5), null, 2));

  const comTransito = produtos.filter((p) => p.quantidadeEmTransito > 0);
  console.log(`Produtos com quantidade em trânsito > 0: ${comTransito.length} (todos devem ter transitoConfiavel=false hoje)`);
  console.log(`  -> transitoConfiavel sempre false? ${comTransito.every((p) => p.transitoConfiavel === false)}`);

  console.log("\n=== Amostra de 5 produtos ===");
  console.log(JSON.stringify(produtos.slice(0, 5), null, 2));

  const comNecessidade = produtos.filter((p) => p.necessidadeReposicao);
  console.log(`\nProdutos com necessidadeReposicao=true: ${comNecessidade.length}`);
  if (comNecessidade.length > 0) {
    const { getProdutoPlanejamentoDetalhe } = await import("../src/lib/metrics/planejamento-estoque");
    const detalhe = await getProdutoPlanejamentoDetalhe(comNecessidade[0].produto);
    console.log(`\n=== Detalhe de "${comNecessidade[0].produto}" (1 produto com necessidade real) ===`);
    console.log(JSON.stringify(detalhe, null, 2).slice(0, 4000));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
