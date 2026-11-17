/**
 * Validação SOMENTE LEITURA, temporária — Fase 2B do Planejamento Inteligente de Estoque
 * (src/lib/metrics/planejamento-distribuicao.ts). Roda as mesmas funções que a tela
 * (src/app/dashboard/planejamento-estoque/page.tsx) chama, contra o banco real, pra confirmar
 * que a camada nova não quebra com dado de produção e que as regras de negócio desta fase
 * (nunca esvaziar origem abaixo de mínimo+margem, nunca contar produção/trânsito como disponível,
 * proteção de Drop em ciclo ativo, reserva de continuidade de Best Seller, visibilidade de
 * produto não classificado) se comportam como esperado também fora do teste sintético.
 *
 * Atualizado (Rodrigo, 2026-11-17) pra também validar o AJUSTE de regra desta revisão: Drop ativo
 * bloqueando excesso (não só oportunidades), reserva de continuidade de Best Seller com leadTime
 * real, e produto NAO_CLASSIFICADO/MISTO aparecendo normalmente com `classificacao` exposta.
 *
 * NÃO escreve nada — getExcessosEDistribuicao/getProdutoExcessoDistribuicao/
 * getDecisoesMovimentacaoPorStatus são 100% leitura (ver planejamento-distribuicao.ts).
 *
 * Uso: npx tsx scripts/validar-planejamento-distribuicao-fase2b-temp.ts
 * (via GitHub Actions: .github/workflows/validar-planejamento-distribuicao-fase2b-temp.yml,
 * workflow_dispatch manual, DATABASE_URL de produção via secret — só pode ser disparado DEPOIS
 * do merge deste PR em main, porque o workflow só existe na branch depois de mergeado.)
 */
import { getExcessosEDistribuicao, getDecisoesMovimentacaoPorStatus } from "@/lib/metrics";

async function main() {
  console.log("=== Fase 2B — validação somente-leitura contra produção ===\n");

  const resultado = await getExcessosEDistribuicao();
  console.log(`Produtos com algum sinal de excesso/ruptura/oportunidade: ${resultado.length}`);

  const comExcessoCD = resultado.filter((r) => r.excessoCD > 0).length;
  const comExcessoLojas = resultado.filter((r) => r.excessoLojas > 0).length;
  const comRuptura = resultado.filter((r) => r.rupturaLojas > 0).length;
  const comRupturaEExcesso = resultado.filter((r) => r.rupturaComExcessoDisponivel).length;
  const comOportunidades = resultado.filter((r) => r.oportunidades.length > 0).length;
  const comDropProtegido = resultado.filter((r) => r.dropsCicloAtivoProtegidos > 0).length;
  const comExcessoDropProtegido = resultado.filter((r) => r.excessoDropProtegido > 0).length;
  const comReservaBestSeller = resultado.filter((r) => r.reservaContinuidadeBestSeller > 0).length;

  console.log(`  com excesso no CD/Site: ${comExcessoCD}`);
  console.log(`  com excesso em loja: ${comExcessoLojas}`);
  console.log(`  com loja em ruptura/crítico: ${comRuptura}`);
  console.log(`  ruptura + excesso disponível no mesmo produto (sinal-chave): ${comRupturaEExcesso}`);
  console.log(`  com oportunidade de transferência: ${comOportunidades}`);
  console.log(`  com oportunidade suprimida por Drop em ciclo ativo: ${comDropProtegido}`);
  console.log(`  com excesso retido por Drop em ciclo ativo (ajuste desta revisão): ${comExcessoDropProtegido}`);
  console.log(`  com reserva de continuidade de Best Seller (ajuste desta revisão): ${comReservaBestSeller}`);

  const porClassificacao = new Map<string, number>();
  for (const r of resultado) porClassificacao.set(r.classificacao, (porClassificacao.get(r.classificacao) ?? 0) + 1);
  console.log(`  por classificação: ${JSON.stringify(Object.fromEntries(porClassificacao))}`);

  // Checagem de honestidade desta revisão: produto NAO_CLASSIFICADO/MISTO nunca deveria ter
  // excessoDropProtegido/reservaContinuidadeBestSeller > 0 — essas réguas são indexadas por
  // tipoCompra === DROP/BEST_SELLER, nunca deveriam "vazar" pra quem não tem essa classificação.
  const vazamento = resultado.filter(
    (r) => (r.classificacao === "NAO_CLASSIFICADO" || r.classificacao === "MISTO") && (r.excessoDropProtegido > 0 || r.reservaContinuidadeBestSeller > 0)
  );
  console.log(`Produtos NAO_CLASSIFICADO/MISTO com retenção indevida de Drop/Best Seller: ${vazamento.length} (esperado: 0)`);
  for (const v of vazamento) console.log(`  ALERTA: ${v.produto} (${v.classificacao}) excessoDropProtegido=${v.excessoDropProtegido} reservaContinuidadeBestSeller=${v.reservaContinuidadeBestSeller}`);

  const naoClassificado = resultado.find((r) => r.classificacao === "NAO_CLASSIFICADO");
  if (naoClassificado) {
    console.log("\nExemplo de produto NAO_CLASSIFICADO (prova de que continua visível, não escondido):");
    console.log(JSON.stringify({ produto: naoClassificado.produto, excessoCD: naoClassificado.excessoCD, excessoLojas: naoClassificado.excessoLojas, rupturaLojas: naoClassificado.rupturaLojas }, null, 2));
  } else {
    console.log("\nNenhum produto NAO_CLASSIFICADO com sinal nesta passada (não é erro, só não havia exemplo pra mostrar).");
  }

  const bestSellerComReserva = resultado.find((r) => r.classificacao === "BEST_SELLER" && r.reservaContinuidadeBestSeller > 0);
  if (bestSellerComReserva) {
    console.log("\nExemplo de Best Seller com reserva de continuidade aplicada (prova de que NÃO é imunidade: excesso real pode ficar > 0 mesmo com reserva):");
    console.log(
      JSON.stringify(
        { produto: bestSellerComReserva.produto, excessoCD: bestSellerComReserva.excessoCD, excessoLojas: bestSellerComReserva.excessoLojas, reservaContinuidadeBestSeller: bestSellerComReserva.reservaContinuidadeBestSeller },
        null,
        2
      )
    );
  } else {
    console.log("\nNenhum Best Seller com reserva de continuidade aplicada nesta passada (provável: nenhum grupo Best Seller tem leadTimeDias configurado em CoberturaMeta ainda — reserva fica 0, comportamento idêntico ao de antes).");
  }

  // Checagem de regra: nenhuma oportunidade deveria deixar a origem com estoqueOrigemDepois
  // negativo (o motor já garante isso — aqui é só uma prova adicional contra dado real, nunca
  // recalculando a regra).
  let origemNegativa = 0;
  for (const r of resultado) {
    for (const o of r.oportunidades) {
      if (o.estoqueOrigemDepois < 0) {
        origemNegativa += 1;
        console.log(`  ALERTA: ${o.produto} (${o.cod}) origem ${o.origemNome} ficaria negativa: ${o.estoqueOrigemDepois}`);
      }
    }
  }
  console.log(`Oportunidades com estoqueOrigemDepois negativo: ${origemNegativa} (esperado: 0)`);

  // Reconciliação simples: soma de quantidadeSugerida == soma do que entra nos destinos, por
  // produto (mesma prova do teste unitário, agora com dado real).
  let divergencias = 0;
  for (const r of resultado) {
    const saida = r.oportunidades.reduce((s, o) => s + o.quantidadeSugerida, 0);
    const entrada = r.oportunidades.reduce((s, o) => s + (o.estoqueDestinoDepois - o.estoqueDestinoAntes), 0);
    if (saida !== entrada) {
      divergencias += 1;
      console.log(`  ALERTA: ${r.produto} saída=${saida} entrada=${entrada}`);
    }
  }
  console.log(`Produtos com divergência saída≠entrada: ${divergencias} (esperado: 0)`);

  if (resultado.length > 0) {
    const exemplo = resultado[0];
    console.log("\nExemplo (1º produto da lista):");
    console.log(
      JSON.stringify(
        {
          produto: exemplo.produto,
          grupo: exemplo.grupo,
          classificacao: exemplo.classificacao,
          excessoCD: exemplo.excessoCD,
          estoqueCDPermanece: exemplo.estoqueCDPermanece,
          excessoLojas: exemplo.excessoLojas,
          rupturaLojas: exemplo.rupturaLojas,
          rupturaComExcessoDisponivel: exemplo.rupturaComExcessoDisponivel,
          oportunidades: exemplo.oportunidades.length,
          dropsCicloAtivoProtegidos: exemplo.dropsCicloAtivoProtegidos,
          excessoDropProtegido: exemplo.excessoDropProtegido,
          reservaContinuidadeBestSeller: exemplo.reservaContinuidadeBestSeller,
        },
        null,
        2
      )
    );

    const decisoes = await getDecisoesMovimentacaoPorStatus({ produto: exemplo.produto });
    console.log("\nDecisões já registradas pra esse produto (histórico):");
    console.log(
      JSON.stringify(
        {
          migrationPendente: decisoes.migrationPendente,
          pendente: decisoes.pendente.length,
          aprovada: decisoes.aprovada.length,
          executada: decisoes.executada.length,
          recusada: decisoes.recusada.length,
        },
        null,
        2
      )
    );
  }

  console.log("\n=== Fim da validação ===");
}

main()
  .catch((e) => {
    console.error("Validação falhou:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });
