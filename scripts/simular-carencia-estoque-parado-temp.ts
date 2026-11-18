/**
 * Simulação SOMENTE LEITURA, temporária — Etapa 3 do pedido do Rodrigo (2026-11-18): medir o
 * impacto de aplicar um período de carência (baseado em ClassificacaoProduto.dataLancamento) antes
 * de classificar uma posição como "estoque_parado" (distribuicao-estoque.ts:106).
 *
 * LIMITAÇÃO DE DADOS JÁ CONFIRMADA (ver docs/planejamento-inteligente-estoque.md §18, investigação
 * de 2 agentes): StockSnapshot é upsert (sem histórico), ProductionOrder não tem storeId (não dá
 * pra saber quando um SKU chegou numa loja específica), e ClassificacaoProduto.dataLancamento é
 * 100% manual, provavelmente com baixa cobertura. Esta simulação usa a ÚNICA data real disponível
 * (dataLancamento) — o resultado é um LIMITE INFERIOR do impacto real (produtos sem essa data
 * cadastrada não entram na simulação, mesmo que também sejam recém-lançados).
 *
 * NÃO escreve nada. Uso: npx tsx scripts/simular-carencia-estoque-parado-temp.ts
 */
import { getComparacaoCompleta, construirOrigem } from "@/lib/metrics";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("=== Simulação de carência para 'estoque_parado' (somente leitura, produção) ===\n");

  // --- Cobertura dos dados (pergunta 5 da Etapa 1) ---
  const totalClassificados = await prisma.classificacaoProduto.count();
  const comDataLancamento = await prisma.classificacaoProduto.count({ where: { dataLancamento: { not: null } } });
  const codsComEstoqueRows = await prisma.stockSnapshot.findMany({ distinct: ["cod"], select: { cod: true } });
  console.log(`ClassificacaoProduto: ${totalClassificados} cod(s) classificado(s), ${comDataLancamento} com dataLancamento preenchida.`);
  console.log(`Cods distintos com StockSnapshot (universo de estoque real): ${codsComEstoqueRows.length}.`);
  console.log(`Cobertura de dataLancamento sobre o universo de estoque: ${((comDataLancamento / codsComEstoqueRows.length) * 100).toFixed(1)}%.\n`);

  const porStatusOrdens = await prisma.productionOrder.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("ProductionOrder por status (confirma se null em dataFinalizacaoProducao == sempre aberta):");
  for (const o of porStatusOrdens) {
    const comData = await prisma.productionOrder.count({ where: { status: o.status, dataFinalizacaoProducao: { not: null } } });
    console.log(`  status=${o.status} total=${o._count._all} comDataFinalizacao=${comData}`);
  }

  // --- Mapa de dataLancamento por cod ---
  const classificados = await prisma.classificacaoProduto.findMany({ select: { cod: true, dataLancamento: true } });
  const dataLancamentoPorCod = new Map(classificados.filter((c) => c.dataLancamento).map((c) => [c.cod, c.dataLancamento as Date]));

  // --- Diagnóstico real de hoje, via getComparacaoCompleta (reaproveita o motor já validado) ---
  const { variantes } = await getComparacaoCompleta();
  const agora = Date.now();
  const JANELAS = [30, 60, 90] as const;
  const porJanela: Record<number, { posicoes: number; unidades: number; disponivel: number }> = {
    30: { posicoes: 0, unidades: 0, disponivel: 0 },
    60: { posicoes: 0, unidades: 0, disponivel: 0 },
    90: { posicoes: 0, unidades: 0, disponivel: 0 },
  };
  let totalPosicoesParadas = 0;
  let totalUnidadesParadas = 0;
  let paradasComDataLancamento = 0;
  const afetadosPorProduto90d = new Map<string, number>();

  for (const v of variantes) {
    const dl = dataLancamentoPorCod.get(v.cod);
    for (const l of v.porLoja) {
      if (l.diagnostico !== "estoque_parado") continue;
      totalPosicoesParadas += 1;
      totalUnidadesParadas += l.estoqueAtual;
      if (!dl) continue;
      paradasComDataLancamento += 1;
      const diasDesdeLancamento = (agora - dl.getTime()) / 86_400_000;
      const disponivel = construirOrigem(l).disponivel;
      for (const janela of JANELAS) {
        if (diasDesdeLancamento <= janela) {
          porJanela[janela].posicoes += 1;
          porJanela[janela].unidades += l.estoqueAtual;
          porJanela[janela].disponivel += disponivel;
          if (janela === 90) afetadosPorProduto90d.set(v.produto, (afetadosPorProduto90d.get(v.produto) ?? 0) + l.estoqueAtual);
        }
      }
    }
  }

  console.log(`\nPosições diagnosticadas 'estoque_parado' hoje (sem nenhuma carência): ${totalPosicoesParadas} (${totalUnidadesParadas} unidades totais)`);
  console.log(`Dessas, com dataLancamento cadastrada (único dado real disponível pra simular): ${paradasComDataLancamento}`);
  for (const janela of JANELAS) {
    const p = porJanela[janela];
    console.log(
      `  Carência de ${janela}d: ${p.posicoes} posição(ões) deixariam de ser 'estoque_parado' (${p.unidades} un. totais, ${p.disponivel} un. que hoje contam pra excesso via construirOrigem)`
    );
  }

  console.log("\nProdutos mais afetados com carência de 90 dias (top 10, só os com dataLancamento cadastrada):");
  [...afetadosPorProduto90d.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([produto, unidades]) => console.log(`  ${produto}: ${unidades} un.`));

  console.log(
    `\nAVISO: ${totalPosicoesParadas - paradasComDataLancamento} posições 'estoque_parado' (de ${totalPosicoesParadas}) NÃO têm dataLancamento cadastrada — não entraram nesta simulação. O impacto real de uma regra de carência é maior do que o medido aqui, mas não pode ser quantificado com os dados atuais (ver limitação no cabeçalho do script).`
  );

  console.log("\n=== Fim da simulação ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
