/**
 * Verificação temporária, SOMENTE LEITURA — Fase 2A do Planejamento de Estoque (tendência,
 * demanda mascarada, grade sugerida por cor/tamanho). Chama as funções reais contra produção.
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const { getProdutosPlanejamento } = await import("../src/lib/metrics/planejamento-estoque");
  const { getRecomendacaoGradeProduto } = await import("../src/lib/metrics/planejamento-grade");

  const produtos = await getProdutosPlanejamento();
  console.log(`Total de produtos: ${produtos.length}`);

  const porTendencia = new Map<string, number>();
  for (const p of produtos) porTendencia.set(p.tendencia, (porTendencia.get(p.tendencia) ?? 0) + 1);
  console.log("Por tendência:", JSON.stringify(Object.fromEntries(porTendencia), null, 2));

  const mascarados = produtos.filter((p) => p.demandaPossivelmenteMascarada);
  console.log(`Com demandaPossivelmenteMascarada=true: ${mascarados.length}`);
  console.log(`  -> todos em ruptura/cobertura_critica? ${mascarados.every((p) => p.situacao === "ruptura" || p.situacao === "cobertura_critica")}`);
  const naoMascaradosEmRisco = produtos.filter((p) => (p.situacao === "ruptura" || p.situacao === "cobertura_critica") && !p.demandaPossivelmenteMascarada);
  console.log(`  -> algum em risco mas SEM a flag (inconsistência, deveria ser 0): ${naoMascaradosEmRisco.length}`);

  // Testa a grade sugerida pros produtos classificados (Best Seller/Drop) que tiverem recomendação real.
  const classificados = produtos.filter((p) => p.classificacao === "BEST_SELLER" || p.classificacao === "DROP");
  console.log(`\nProdutos classificados (Best Seller/Drop): ${classificados.length}`);

  let testados = 0;
  for (const p of classificados) {
    const grade = await getRecomendacaoGradeProduto(p.produto);
    testados++;
    if (!grade) {
      console.log(`${p.produto}: sem recomendação de grade (motor não gerou sugestão > 0)`);
      continue;
    }
    const somaCores = grade.porCor.reduce((s, c) => s + c.quantidadeSugerida, 0);
    const somaTamanhosOk = grade.porCor.every((c) => c.porTamanho.reduce((s, t) => s + t.quantidadeSugerida, 0) === c.quantidadeSugerida);
    console.log(`${p.produto} (${p.classificacao}): total=${grade.quantidadeSugeridaTotal}, somaCores=${somaCores}, fechaComTotal=${somaCores === grade.quantidadeSugeridaTotal}, cadaCorFechaComSeusTamanhos=${somaTamanhosOk}, cores=${grade.porCor.map((c) => c.cor).join(",")}`);
  }
  console.log(`\nGrades testadas: ${testados}`);

  // Simula "a página abre, detalhe carrega" (item 4 do pedido) chamando a mesma função que
  // page.tsx chama quando ?produto=<nome>. Escolhe um produto real com estoque > 0 (não os
  // classificados, que no momento todos têm quantidade 0/null) pra ter algo substancial pra
  // reconciliar. Mesma checagem de fechamento de totais já coberta nos testes unitários, agora
  // contra dado real de produção.
  const { getProdutoPlanejamentoDetalhe } = await import("../src/lib/metrics/planejamento-estoque");
  const candidato = produtos.find((p) => p.estoqueTotal > 0 && p.cods.length > 1) ?? produtos.find((p) => p.estoqueTotal > 0);
  if (candidato) {
    const detalhe = await getProdutoPlanejamentoDetalhe(candidato.produto);
    console.log(`\n=== Detalhe de "${candidato.produto}" (estoqueTotal=${candidato.estoqueTotal}, ${candidato.cods.length} cod(s)) ===`);
    if (!detalhe) {
      console.log("ERRO: detalhe veio null para um produto que está na lista principal.");
    } else {
      const somaPorCorTamanho = detalhe.porCor.reduce((s, c) => s + c.porTamanho.reduce((s2, t) => s2 + t.estoqueTotal, 0), 0);
      const somaPorLoja = detalhe.porLoja.reduce((s, l) => s + l.estoqueAtual, 0);
      console.log(`estoqueTotal (lista) = ${candidato.estoqueTotal}`);
      console.log(`soma porCor->porTamanho (detalhe) = ${somaPorCorTamanho} -> fecha? ${somaPorCorTamanho === candidato.estoqueTotal}`);
      console.log(`soma porLoja (detalhe) = ${somaPorLoja} -> fecha? ${somaPorLoja === candidato.estoqueTotal}`);
      console.log(`porLoja: ${JSON.stringify(detalhe.porLoja.map((l) => ({ posicaoNome: l.posicaoNome, estoqueAtual: l.estoqueAtual, vendasDias30: l.vendasDias30, diagnostico: l.diagnostico })))}`);
    }
  } else {
    console.log("\nNenhum produto com estoqueTotal > 0 encontrado pra testar o detalhe.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
