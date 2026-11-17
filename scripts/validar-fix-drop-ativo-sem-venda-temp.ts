/**
 * Validação SOMENTE LEITURA, temporária — correção de 2026-11-17 na proteção de Drop ativo
 * (src/lib/metrics/planejamento-distribuicao.ts): a proteção deixou de depender de
 * vendasDias90/vendasOrigem90 > 0 — agora todo Drop ativo (independente de venda recente) é
 * excluído do contador de excesso E das oportunidades de transferência; Drop encerrado continua
 * avaliado normalmente.
 *
 * Confirma contra dado real de produção: existe algum Drop ativo SEM venda nos últimos 90 dias
 * que, antes da correção, teria contado como excesso/gerado oportunidade de transferência e que,
 * depois da correção, está protegido? E confirma que Drop encerrado continua sem proteção
 * especial, Best Seller/não classificado/MISTO continuam intocados.
 *
 * NÃO escreve nada — getExcessosEDistribuicao é 100% leitura.
 *
 * Uso: npx tsx scripts/validar-fix-drop-ativo-sem-venda-temp.ts
 */
import { getExcessosEDistribuicao } from "@/lib/metrics";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("=== Correção Drop ativo sem venda — validação somente-leitura contra produção ===\n");

  const cods = await prisma.classificacaoProduto.findMany({
    where: { tipoCompra: "DROP" },
    select: { cod: true, produto: true, statusComercial: true, dataEncerramentoPrevista: true },
  });
  const agora = Date.now();
  const dropsAtivos = cods.filter(
    (d) =>
      d.statusComercial !== "DESCONTINUADO" &&
      d.statusComercial !== "EM_ENCERRAMENTO" &&
      !(d.dataEncerramentoPrevista && d.dataEncerramentoPrevista.getTime() < agora)
  );
  const dropsEncerrados = cods.filter((d) => !dropsAtivos.includes(d));
  console.log(`Cods classificados como DROP em produção: ${cods.length} (ativos: ${dropsAtivos.length}, encerrados: ${dropsEncerrados.length})`);

  const resultado = await getExcessosEDistribuicao();
  console.log(`Produtos com algum sinal: ${resultado.length}`);

  const produtosDropAtivo = resultado.filter((r) => r.classificacao === "DROP" && r.excessoDropProtegido > 0);
  console.log(`\nProdutos DROP com excesso retido pela proteção (excessoDropProtegido > 0): ${produtosDropAtivo.length}`);
  for (const p of produtosDropAtivo.slice(0, 10)) {
    console.log(`  ${p.produto} (${p.grupo}) excessoDropProtegido=${p.excessoDropProtegido} dropsCicloAtivoProtegidos=${p.dropsCicloAtivoProtegidos}`);
  }

  const produtosDropComExcessoAindaContando = resultado.filter((r) => r.classificacao === "DROP" && (r.excessoCD > 0 || r.excessoLojas > 0));
  console.log(`\nProdutos DROP que AINDA mostram excesso real (esperado: só Drop encerrado): ${produtosDropComExcessoAindaContando.length}`);
  for (const p of produtosDropComExcessoAindaContando.slice(0, 10)) {
    console.log(`  ${p.produto} (${p.grupo}) excessoCD=${p.excessoCD} excessoLojas=${p.excessoLojas}`);
  }

  // Checagem de honestidade: nenhum produto NAO_CLASSIFICADO/MISTO/BEST_SELLER deveria ter
  // excessoDropProtegido > 0 — a régua é indexada só por cods DROP.
  const vazamento = resultado.filter((r) => r.classificacao !== "DROP" && r.excessoDropProtegido > 0);
  console.log(`\nProdutos não-DROP com excessoDropProtegido > 0 (esperado: 0): ${vazamento.length}`);
  for (const v of vazamento) console.log(`  ALERTA: ${v.produto} (${v.classificacao}) excessoDropProtegido=${v.excessoDropProtegido}`);

  // Drill-down: classificacaoAgregada ("DROP") só exige que os cods COM tipoCompra sejam todos
  // DROP — um cod SEM classificação (tipoCompra null) não entra nesse cálculo (ver
  // classificarAgregado em planejamento-estoque.ts) e por isso não herda a proteção de Drop. Se um
  // produto rotulado "DROP" ainda mostra excesso real, a hipótese é que ele tem cod(s) sem
  // classificação misturado(s) com o(s) cod(s) DROP — comportamento correto (não esconder/não
  // inventar Drop pra quem não é), não um vazamento da régua. Confirma isso cod a cod.
  if (produtosDropComExcessoAindaContando.length > 0) {
    console.log("\nDrill-down cod a cod dos produtos DROP que ainda mostram excesso (confirma hipótese de cod sem classificação misturado):");
    for (const p of produtosDropComExcessoAindaContando) {
      const cods = await prisma.classificacaoProduto.findMany({ where: { produto: p.produto }, select: { cod: true, tipoCompra: true } });
      const todosCods = p.cods;
      const codsClassificados = new Set(cods.map((c) => c.cod));
      const codsSemClassificacao = todosCods.filter((c) => !codsClassificados.has(c));
      console.log(
        `  ${p.produto}: ${todosCods.length} cod(s) no total, ${cods.length} classificado(s) (${cods.map((c) => `${c.cod}=${c.tipoCompra}`).join(", ") || "nenhum"}), ${codsSemClassificacao.length} sem classificação (${codsSemClassificacao.join(", ") || "nenhum"})`
      );
    }
  }

  console.log("\n=== Fim da validação ===");
}

main()
  .catch((e) => {
    console.error("Validação falhou:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
