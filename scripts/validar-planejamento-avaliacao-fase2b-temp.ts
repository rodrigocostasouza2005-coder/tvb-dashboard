/**
 * Validação SOMENTE LEITURA, temporária — Fase 2B do Planejamento Inteligente de Estoque
 * (src/lib/metrics/planejamento-avaliacao.ts). Roda as mesmas funções que a tela
 * (mapa-compras/avaliacao) chamaria, contra o banco real, pra confirmar que a camada não quebra
 * com dado de produção e pra responder honestamente: existe alguma DecisaoCompra real hoje, e em
 * que proporção caem em SEM_DADOS/PARCIAL/COMPLETA?
 *
 * NÃO escreve nada — getAvaliacaoDecisoesPorProdutoGrupoPeriodo é 100% leitura.
 *
 * Uso: npx tsx scripts/validar-planejamento-avaliacao-fase2b-temp.ts
 * (via GitHub Actions: .github/workflows/validar-planejamento-avaliacao-fase2b-temp.yml,
 * workflow_dispatch manual, DATABASE_URL de produção via secret — só pode ser disparado DEPOIS
 * do merge deste PR em main.)
 */
import { getAvaliacaoDecisoesPorProdutoGrupoPeriodo } from "@/lib/metrics";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("=== Fase 2B — avaliação retrospectiva de compras: validação somente-leitura contra produção ===\n");

  const totalDecisoes = await prisma.decisaoCompra.count();
  console.log(`Total de linhas em DecisaoCompra: ${totalDecisoes}`);

  const avaliacoes = await getAvaliacaoDecisoesPorProdutoGrupoPeriodo();
  console.log(`Avaliações calculadas: ${avaliacoes.length}`);

  const porAvaliabilidade = new Map<string, number>();
  for (const a of avaliacoes) porAvaliabilidade.set(a.avaliabilidade, (porAvaliabilidade.get(a.avaliabilidade) ?? 0) + 1);
  console.log("Por avaliabilidade:", JSON.stringify(Object.fromEntries(porAvaliabilidade), null, 2));

  const completas = avaliacoes.filter((a) => a.avaliabilidade === "COMPLETA");
  console.log(`\nCOMPLETA: ${completas.length}`);
  for (const c of completas.slice(0, 5)) {
    console.log(`  ${c.cod} (${c.grupo}) decididoEm=${c.decididoEm.toISOString().slice(0, 10)} diasDecorridos=${c.diasDecorridos} recomendado=${c.quantidadeRecomendada} comprado=${c.quantidadeComprada} diagnostico=${c.diagnosticoPosDecisao} rupturaPos=${c.indicioRupturaPosDecisao} excessoRemanescente=${c.indicioExcessoRemanescente}`);
  }

  const parciais = avaliacoes.filter((a) => a.avaliabilidade === "PARCIAL");
  console.log(`\nPARCIAL: ${parciais.length}`);
  for (const p of parciais.slice(0, 5)) {
    console.log(`  ${p.cod ?? "(sem cod)"} (${p.grupo}) baseCalculo=${p.baseCalculo} diasDecorridos=${p.diasDecorridos} avisos=${p.avisos.join(" | ")}`);
  }

  const semDados = avaliacoes.filter((a) => a.avaliabilidade === "SEM_DADOS");
  console.log(`\nSEM_DADOS: ${semDados.length}`);

  // Checagem de honestidade: nenhuma avaliação deveria ter diagnosticoPosDecisao preenchido fora
  // de COMPLETA — prova contra dado real que a função nunca "completa" o que não pode saber.
  const inconsistentes = avaliacoes.filter((a) => a.avaliabilidade !== "COMPLETA" && a.diagnosticoPosDecisao != null);
  console.log(`\nAvaliações não-COMPLETA com diagnosticoPosDecisao preenchido (deveria ser 0): ${inconsistentes.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
