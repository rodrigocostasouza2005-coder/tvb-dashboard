/**
 * Validação operacional SOMENTE LEITURA, temporária — pedido do Rodrigo (2026-11-17/18) pra
 * ganhar confiança no Planejamento Inteligente de Estoque com dado real, sem reabrir fases já
 * concluídas. Consolida, num único script, as hipóteses levantadas por 3 agentes de investigação
 * (Mapa de Compras, Distribuição, Integração entre os dois) que precisavam de dado real de
 * produção pra confirmar ou refutar.
 *
 * NÃO escreve nada — todas as funções usadas (getRecomendacoesBestSeller/Drop,
 * getExcessosEDistribuicao, getProdutosPlanejamento, prisma.*.findMany) são 100% leitura.
 *
 * Uso: npx tsx scripts/validar-operacional-planejamento-estoque-temp.ts
 */
import { getRecomendacoesBestSeller, getRecomendacoesDrop, getExcessosEDistribuicao, getProdutosPlanejamento } from "@/lib/metrics";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("=== Validação operacional — Planejamento Inteligente de Estoque (somente leitura, produção) ===\n");

  // -------------------------------------------------------------------
  // ETAPA 1a — achado do agente de Mapa de Compras: getRecomendacoesDrop não usa dropEmCicloAtivo
  // (só olha dataEncerramentoPrevista, nunca statusComercial). Conta quantos cods DROP já
  // descontinuados/em encerramento ainda aparecem com sugestão de compra positiva.
  // -------------------------------------------------------------------
  console.log("--- Etapa 1a: Drop descontinuado/em encerramento com sugestão de compra viva? ---");
  const dropsEncerradosPorStatus = await prisma.classificacaoProduto.findMany({
    where: { tipoCompra: "DROP", statusComercial: { in: ["DESCONTINUADO", "EM_ENCERRAMENTO"] } },
    select: { cod: true, produto: true, statusComercial: true, possibilidadeReposicao: true, dataEncerramentoPrevista: true },
  });
  console.log(`Cods DROP com statusComercial DESCONTINUADO/EM_ENCERRAMENTO: ${dropsEncerradosPorStatus.length}`);
  for (const d of dropsEncerradosPorStatus) {
    console.log(`  ${d.cod} (${d.produto}) status=${d.statusComercial} possibilidadeReposicao=${d.possibilidadeReposicao} dataEncerramentoPrevista=${d.dataEncerramentoPrevista?.toISOString().slice(0, 10) ?? "null"}`);
  }
  const recomendacoesDrop = await getRecomendacoesDrop();
  const codsEncerradosPorStatusSet = new Set(dropsEncerradosPorStatus.map((d) => d.cod));
  const comSugestaoViva = recomendacoesDrop.filter((r) => codsEncerradosPorStatusSet.has(r.cod) && (r.quantidadeSugerida ?? 0) > 0);
  console.log(`Desses, com quantidadeSugerida > 0 em getRecomendacoesDrop (exposição real HOJE): ${comSugestaoViva.length}`);
  for (const r of comSugestaoViva) console.log(`  ALERTA: ${r.cod} (${r.produto}) quantidadeSugerida=${r.quantidadeSugerida} diasRestantesJanela=${r.diasRestantesJanela}`);

  // -------------------------------------------------------------------
  // ETAPA 1b — achado do agente de Mapa de Compras: grade por cor/tamanho usa Sale por NOME de
  // produto (sem filtrar por cod classificado) — risco de incluir peso de cod irmão não
  // classificado. Confirma se isso já tem efeito prático (quantidadeSugerida > 0 pra algum
  // produto com cods não classificados misturados) ou se continua dormente (§10.7).
  // -------------------------------------------------------------------
  console.log("\n--- Etapa 1b: grade — algum produto classificado já tem quantidadeSugerida > 0? ---");
  const recomendacoesBestSeller = await getRecomendacoesBestSeller();
  const comQuantidade = [
    ...recomendacoesBestSeller.filter((r) => r.quantidadeSugerida > 0).map((r) => ({ ...r, tipo: "BEST_SELLER" as const })),
    ...recomendacoesDrop.filter((r) => (r.quantidadeSugerida ?? 0) > 0).map((r) => ({ ...r, tipo: "DROP" as const })),
  ];
  console.log(`Recomendações (Best Seller + Drop) com quantidadeSugerida > 0: ${comQuantidade.length} (esperado por §10.7: 0 — se > 0, achado passou de dormente pra real)`);
  for (const r of comQuantidade.slice(0, 10)) console.log(`  ${r.cod} (${r.produto}, ${r.tipo}) quantidadeSugerida=${r.quantidadeSugerida}`);

  if (comQuantidade.length > 0) {
    console.log("\nPra cada produto com quantidade > 0, cods classificados vs. cods totais em Sale sob o mesmo nome (mede contaminação da grade):");
    for (const r of comQuantidade) {
      const codsClassificadosMesmoProduto = await prisma.classificacaoProduto.findMany({ where: { produto: r.produto }, select: { cod: true, tipoCompra: true } });
      const codsEmSale = await prisma.sale.findMany({ where: { produto: r.produto }, select: { cod: true }, distinct: ["cod"] });
      console.log(`  ${r.produto}: ${codsEmSale.length} cod(s) com venda, ${codsClassificadosMesmoProduto.length} classificado(s) (${codsClassificadosMesmoProduto.map((c) => `${c.cod}=${c.tipoCompra}`).join(", ") || "nenhum"})`);
    }
  }

  // -------------------------------------------------------------------
  // ETAPA 3 — achado do agente de Integração: motor de compra (agregado por cod, empresa toda)
  // nunca checa se já existe excesso disponível pra transferir em outra posição antes de sugerir
  // compra. Mede quantos cods têm os dois sinais simultâneos hoje.
  // -------------------------------------------------------------------
  console.log("\n--- Etapa 3: cods com sugestão de compra (>0) E oportunidade de transferência simultâneas ---");
  const codsComSugestaoDeCompra = new Set(comQuantidade.map((r) => r.cod));
  const excessos = await getExcessosEDistribuicao();
  const codsComOportunidadeTransferencia = new Map<string, { produto: string; origemNome: string; quantidadeSugerida: number }>();
  for (const produto of excessos) {
    for (const op of produto.oportunidades) {
      if (!codsComOportunidadeTransferencia.has(op.cod)) {
        codsComOportunidadeTransferencia.set(op.cod, { produto: op.produto, origemNome: op.origemNome, quantidadeSugerida: op.quantidadeSugerida });
      }
    }
  }
  const codsComOsDoisSinais = [...codsComSugestaoDeCompra].filter((cod) => codsComOportunidadeTransferencia.has(cod));
  console.log(`Cods com sugestão de compra > 0: ${codsComSugestaoDeCompra.size}`);
  console.log(`Cods com oportunidade de transferência disponível: ${codsComOportunidadeTransferencia.size}`);
  console.log(`Cods com OS DOIS sinais ao mesmo tempo (comprar E transferir, sem cross-reference): ${codsComOsDoisSinais.length}`);
  for (const cod of codsComOsDoisSinais.slice(0, 5)) {
    const compra = comQuantidade.find((r) => r.cod === cod)!;
    const transf = codsComOportunidadeTransferencia.get(cod)!;
    console.log(`  ${cod} (${compra.produto}): compra sugerida=${compra.quantidadeSugerida} | transferência disponível de ${transf.origemNome}, qtd=${transf.quantidadeSugerida}`);
  }

  // -------------------------------------------------------------------
  // ETAPA 2 — checklist de ~10 produtos representativos (critério do agente de Distribuição).
  // -------------------------------------------------------------------
  console.log("\n--- Etapa 2: amostra de produtos representativos ---");
  const produtosPlanejamento = await getProdutosPlanejamento();
  const excessosPorProduto = new Map(excessos.map((e) => [e.produto, e]));

  function resumoProduto(nome: string) {
    const p = produtosPlanejamento.find((x) => x.produto === nome);
    const e = excessosPorProduto.get(nome);
    if (!p) return `  ${nome}: NÃO encontrado em getProdutosPlanejamento`;
    return `  ${nome} [${p.classificacao}] estoqueTotal=${p.estoqueTotal} cods=${p.cods.length} | excesso: ${e ? `excessoCD=${e.excessoCD} excessoLojas=${e.excessoLojas} rupturaLojas=${e.rupturaLojas} excessoDropProtegido=${e.excessoDropProtegido} reservaContinuidadeBestSeller=${e.reservaContinuidadeBestSeller} oportunidades=${e.oportunidades.length}` : "sem sinal (não aparece em getExcessosEDistribuicao)"}`;
  }

  const bestSellers = produtosPlanejamento.filter((p) => p.classificacao === "BEST_SELLER").slice(0, 3);
  console.log("\nBest Seller (até 3):");
  for (const p of bestSellers) console.log(resumoProduto(p.produto));

  console.log("\nDrop ativo conhecido (§15.3) + demais Drop:");
  for (const nome of ["Ultra Light Treko Reverso", "Classic Marinho"]) console.log(resumoProduto(nome));
  const outrosDrops = produtosPlanejamento.filter((p) => p.classificacao === "DROP" && !["Ultra Light Treko Reverso", "Classic Marinho"].includes(p.produto)).slice(0, 2);
  for (const p of outrosDrops) console.log(resumoProduto(p.produto));

  const metaDropsTodos = await prisma.classificacaoProduto.findMany({ where: { tipoCompra: "DROP" }, select: { statusComercial: true, dataEncerramentoPrevista: true } });
  const agora = Date.now();
  const dropsEncerradosCiclo = metaDropsTodos.filter(
    (d) => d.statusComercial === "DESCONTINUADO" || d.statusComercial === "EM_ENCERRAMENTO" || (d.dataEncerramentoPrevista != null && d.dataEncerramentoPrevista.getTime() < agora)
  );
  console.log(`\nDrop encerrado (ciclo, não status): ${dropsEncerradosCiclo.length} de ${metaDropsTodos.length} cods DROP totais (§15.3 registrava 0 em 2026-11-17 — confirmando se mudou)`);

  const naoClassificados = produtosPlanejamento.filter((p) => p.classificacao === "NAO_CLASSIFICADO" && excessosPorProduto.has(p.produto)).slice(0, 2);
  const mistos = produtosPlanejamento.filter((p) => p.classificacao === "MISTO");
  console.log(`\nNão classificado com sinal (até 2, de um universo de ${produtosPlanejamento.filter((p) => p.classificacao === "NAO_CLASSIFICADO").length}):`);
  for (const p of naoClassificados) console.log(resumoProduto(p.produto));
  console.log(`MISTO em produção hoje: ${mistos.length} (doc antigo §10.1 registrava 0)`);
  for (const p of mistos.slice(0, 2)) console.log(resumoProduto(p.produto));

  const maiorEstoque = [...produtosPlanejamento].sort((a, b) => b.estoqueTotal - a.estoqueTotal).slice(0, 2);
  console.log("\nMaior estoqueTotal (até 2):");
  for (const p of maiorEstoque) console.log(resumoProduto(p.produto));

  // Checagem de honestidade: nenhum produto NAO_CLASSIFICADO/MISTO deveria ter excessoDropProtegido
  // ou reservaContinuidadeBestSeller > 0 (vazamento de regra) — mesma checagem de §14/§15, reconfirmada.
  const vazamento = excessos.filter((e) => (e.classificacao === "NAO_CLASSIFICADO" || e.classificacao === "MISTO") && (e.excessoDropProtegido > 0 || e.reservaContinuidadeBestSeller > 0));
  console.log(`\nVazamento de regra Drop/Best Seller pra NAO_CLASSIFICADO/MISTO: ${vazamento.length} (esperado: 0)`);

  // -------------------------------------------------------------------
  // ETAPA 2b — achado da amostra: "Classic Black" (BEST_SELLER) apareceu com excessoCD=873 e
  // rupturaLojas=3 ao mesmo tempo que oportunidades=0. Hipótese: mesma classe de distorção já
  // confirmada pra Drop (§15.3) — o resumo é por PRODUTO (soma todos os cods/cores/tamanhos), mas
  // o motor real de transferência (calcularMovimentacoes) decide por COD — o excesso e a ruptura
  // podem estar em cods/posições diferentes do mesmo produto, sem "match" real pro motor sugerir.
  // Mede quantos produtos têm esse padrão (excesso E ruptura sem nenhuma oportunidade) e, pro
  // primeiro caso, quebra por cod pra confirmar a hipótese (ou refutar, se não for isso).
  // -------------------------------------------------------------------
  console.log("\n--- Etapa 2b: produtos com excesso E ruptura simultâneos mas ZERO oportunidades de transferência ---");
  const excessoERupturaSemOportunidade = excessos.filter((e) => (e.excessoCD > 0 || e.excessoLojas > 0) && e.rupturaLojas > 0 && e.oportunidades.length === 0);
  console.log(`Produtos nessa situação: ${excessoERupturaSemOportunidade.length} de ${excessos.length} produtos com sinal`);
  for (const e of excessoERupturaSemOportunidade.slice(0, 5)) {
    console.log(`  ${e.produto} [${e.classificacao}] excessoCD=${e.excessoCD} excessoLojas=${e.excessoLojas} rupturaLojas=${e.rupturaLojas}`);
  }
  if (excessoERupturaSemOportunidade.length > 0) {
    const alvo = excessoERupturaSemOportunidade[0];
    console.log(`\nDrill-down por cod/posição de "${alvo.produto}" (primeiro caso da lista):`);
    const variantesDetalhe = await prisma.stockSnapshot.findMany({
      where: { cod: { in: alvo.cods } },
      select: { cod: true, storeId: true, quantidadeDisponivel: true },
    });
    const vendasPorCod = await prisma.sale.groupBy({
      by: ["cod"],
      where: { cod: { in: alvo.cods }, status: { not: "Cancelada" } },
      _sum: { quantidade: true },
    });
    const estoquePorCod = new Map<string, number>();
    for (const v of variantesDetalhe) estoquePorCod.set(v.cod, (estoquePorCod.get(v.cod) ?? 0) + v.quantidadeDisponivel);
    const vendaPorCodMap = new Map(vendasPorCod.map((v) => [v.cod, v._sum.quantidade ?? 0]));
    for (const cod of alvo.cods) {
      console.log(`  cod=${cod} estoqueTotal(todas posições)=${estoquePorCod.get(cod) ?? 0} vendaTotal(todo período, todas posições)=${vendaPorCodMap.get(cod) ?? 0}`);
    }
    console.log("  (se o estoque alto e a venda estiverem concentrados em cods DIFERENTES, confirma a hipótese: excesso e ruptura são de cods/posições diferentes do mesmo produto, o motor real não erra)");
  }

  console.log("\n=== Fim da validação ===");
}

main()
  .catch((e) => {
    console.error("Validação falhou:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
