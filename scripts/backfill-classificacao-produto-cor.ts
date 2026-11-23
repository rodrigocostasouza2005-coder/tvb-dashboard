// Migração de dado real pra raise do grão de ClassificacaoProduto (cod -> produto+cor, pedido do
// Rodrigo 2026-11-19/23 — ver prisma/schema.prisma no model ClassificacaoProduto pro porquê).
//
// QUANDO USAR ISTO: só em um ambiente cujo ClassificacaoProduto AINDA tem dado no formato antigo
// (coluna `cod`, 1 linha por SKU) — ou seja, produção, até alguém rodar isto lá. No Neon dev a
// tabela estava com 0 linhas quando esta mudança foi feita, então a migration do Prisma
// (prisma/migrations/20261123160000_raise_grao_classificacao_produto_cor) foi aplicada direto,
// sem precisar deste script. Rodar este script contra um banco que já está no formato novo
// (sem coluna `cod`) é seguro — ele detecta isso e não faz nada (idempotente).
//
// COMO USAR: por padrão roda em DRY RUN — só lê, nunca escreve, e imprime um relatório completo:
// quantos produto+cor distintos existem, quantos têm mais de 1 cod agrupado, e DENTRE ESSES,
// quantos são conflito REAL (cods da mesma cor com tipoCompra/status/possibilidade/etc.
// DIFERENTES entre si — só podia existir porque o grão antigo permitia) vs. duplicata inofensiva
// (mesmo valor repetido). Pra aplicar de verdade, rodar de novo com --apply.
//
//   npx tsx scripts/backfill-classificacao-produto-cor.ts           (dry run, só relatório)
//   npx tsx scripts/backfill-classificacao-produto-cor.ts --apply   (aplica de verdade)
//
// REGRA DE RESOLUÇÃO DE CONFLITO (documentada em detalhe em classificacao-migracao.ts): quando
// cods da MESMA cor têm classificações diferentes, vence a linha com `updatedAt` mais recente —
// a decisão humana mais recente prevalece. O relatório mostra TODO conflito encontrado (produto,
// cor, cods envolvidos, campos que divergiam, qual linha venceu) ANTES de qualquer escrita —
// nunca resolve silenciosamente sem mostrar o que aconteceu.
//
// O QUE --apply faz, nesta ordem (cada etapa é segura de rodar de novo se a anterior já tiver
// sido feita — reexecutar o script do zero depois de uma falha no meio não duplica nem corrompe
// nada):
//   1. Garante (ADD COLUMN IF NOT EXISTS) as colunas `cor`/`produtoCor` como NULLABLE — aditivo,
//      nunca remove nada.
//   2. Resolve a cor REAL de cada cod via Sale/StockSnapshot (nunca inventada) e preenche `cor`
//      de toda linha que ainda não tem.
//   3. Pra cada grupo produto+cor com mais de 1 linha: aplica a regra de resolução acima,
//      repointa ClassificacaoProdutoHistorico das linhas perdedoras pra vencedora (preserva o
//      histórico, nunca descarta) e deleta as linhas perdedoras.
//   4. Preenche `produtoCor` de toda linha restante.
//   5. Verifica que SOBROU zero linha com `cor` nula e zero `produtoCor` duplicado — se sobrar
//      (ex.: cod sem base real em Sale/StockSnapshot), PARA aqui, sem tocar nas colunas finais,
//      e lista exatamente quais linhas ficaram pendentes pra decisão manual.
//   6. Só se a verificação acima passar 100%: aplica NOT NULL em `cor`/`produtoCor`, cria o
//      índice único em `produtoCor`, remove o índice único antigo de `cod` e finalmente dropa a
//      coluna `cod`.
//
// Depois que este script terminar com sucesso (etapa 6 concluída) contra um banco, ele já está
// no mesmo estado final que a migration do Prisma aplicada no dev — não precisa rodar a
// migration.sql separadamente.

import { PrismaClient } from "@prisma/client";
import {
  agruparEResolverClassificacoes,
  type LinhaClassificacaoAntiga,
} from "../src/lib/metrics/classificacao-migracao";

const prisma = new PrismaClient();

async function colunaExiste(tabela: string, coluna: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2
     ) AS exists`,
    tabela,
    coluna
  );
  return rows[0]?.exists ?? false;
}

async function main() {
  const aplicar = process.argv.includes("--apply");
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  console.log(`Host: ${host}`);
  console.log(`Modo: ${aplicar ? "APLICAR (vai escrever no banco)" : "DRY RUN (só leitura)"}`);

  const temCod = await colunaExiste("ClassificacaoProduto", "cod");
  if (!temCod) {
    console.log("ClassificacaoProduto já está no formato novo (sem coluna `cod`) — nada a fazer.");
    return;
  }

  const linhasRaw = await prisma.$queryRawUnsafe<
    {
      id: string;
      cod: string;
      produto: string;
      grupo: string;
      colecao: string | null;
      tipoCompra: string;
      statusComercial: string;
      possibilidadeReposicao: string;
      dataLancamento: Date | null;
      dataEncerramentoPrevista: Date | null;
      orcamentoDrop: number | null;
      observacoes: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[]
  >(
    `SELECT id, cod, produto, grupo, colecao, "tipoCompra", "statusComercial", "possibilidadeReposicao",
            "dataLancamento", "dataEncerramentoPrevista", "orcamentoDrop", observacoes, "createdAt", "updatedAt"
     FROM "ClassificacaoProduto"`
  );
  console.log(`Linhas encontradas (formato antigo, por cod): ${linhasRaw.length}`);
  if (linhasRaw.length === 0) {
    console.log("Tabela vazia — nada a consolidar. Só a migration de schema é necessária.");
    return;
  }

  const linhas: LinhaClassificacaoAntiga[] = linhasRaw.map((l) => ({
    id: l.id,
    cod: l.cod,
    produto: l.produto,
    grupo: l.grupo,
    colecao: l.colecao,
    tipoCompra: l.tipoCompra,
    statusComercial: l.statusComercial,
    possibilidadeReposicao: l.possibilidadeReposicao,
    dataLancamento: l.dataLancamento ? l.dataLancamento.toISOString() : null,
    dataEncerramentoPrevista: l.dataEncerramentoPrevista ? l.dataEncerramentoPrevista.toISOString() : null,
    orcamentoDrop: l.orcamentoDrop,
    observacoes: l.observacoes,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  }));

  // Cor real de cada cod — união de Sale + StockSnapshot, mesma fonte de verdade usada em todo o
  // resto do app (ver resolverProdutoCorPorCod em compras-inteligencia.ts). NUNCA inventada.
  const cods = [...new Set(linhas.map((l) => l.cod))];
  const [vendas, estoque] = await Promise.all([
    prisma.sale.findMany({ where: { cod: { in: cods } }, distinct: ["cod"], select: { cod: true, cor: true } }),
    prisma.stockSnapshot.findMany({ where: { cod: { in: cods } }, distinct: ["cod"], select: { cod: true, cor: true } }),
  ]);
  const corPorCod = new Map<string, string>();
  for (const r of [...vendas, ...estoque]) {
    if (!corPorCod.has(r.cod) && r.cor != null) corPorCod.set(r.cod, r.cor);
  }

  const { grupos, semBaseReal } = agruparEResolverClassificacoes(linhas, corPorCod);

  const gruposComMultiplasLinhas = grupos.filter((g) => g.linhas.length > 1);
  const gruposComConflito = grupos.filter((g) => g.conflita);

  console.log(`\n--- RELATÓRIO ---`);
  console.log(`Produto+cor distintos: ${grupos.length}`);
  console.log(`Produto+cor com mais de 1 cod agrupado: ${gruposComMultiplasLinhas.length}`);
  console.log(`  dos quais são CONFLITO REAL (campos divergentes, não só duplicata): ${gruposComConflito.length}`);
  console.log(`Linhas SEM base real (cod não encontrado em Sale/StockSnapshot) — ficam de fora, nunca adivinhadas: ${semBaseReal.length}`);
  if (semBaseReal.length > 0) {
    console.log("  cods sem base real:", semBaseReal.map((l) => l.cod));
  }

  if (gruposComConflito.length > 0) {
    console.log(`\n--- CONFLITOS DETALHADOS (${gruposComConflito.length}) ---`);
    for (const g of gruposComConflito) {
      console.log(`\nproduto+cor: ${g.produtoCor}`);
      console.log(`  campos divergentes: ${g.camposDivergentes.join(", ")}`);
      console.log(`  vencedora (updatedAt mais recente): cod=${g.vencedora.cod} id=${g.vencedora.id} updatedAt=${g.vencedora.updatedAt}`);
      for (const campo of g.camposDivergentes) {
        console.log(`    ${campo}: vencedora=${JSON.stringify((g.vencedora as unknown as Record<string, unknown>)[campo])}`);
      }
      for (const perdedora of g.perdedoras) {
        console.log(`  perdedora: cod=${perdedora.cod} id=${perdedora.id} updatedAt=${perdedora.updatedAt}`);
        for (const campo of g.camposDivergentes) {
          console.log(`    ${campo}: perdedora=${JSON.stringify((perdedora as unknown as Record<string, unknown>)[campo])}`);
        }
      }
    }
  }

  if (!aplicar) {
    console.log(`\nDRY RUN concluído — nada foi escrito. Rode com --apply pra consolidar de verdade.`);
    return;
  }

  if (semBaseReal.length > 0) {
    console.log(
      `\nABORTADO: ${semBaseReal.length} linha(s) sem base real em Sale/StockSnapshot — não há como resolver a cor dela(s) sem adivinhar. Resolva manualmente (ou decida descartar essas linhas) antes de rodar --apply de novo.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n--- APLICANDO ---`);

  await prisma.$executeRawUnsafe(`ALTER TABLE "ClassificacaoProduto" ADD COLUMN IF NOT EXISTS "cor" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ClassificacaoProduto" ADD COLUMN IF NOT EXISTS "produtoCor" TEXT`);

  for (const linha of linhas) {
    const cor = corPorCod.get(linha.cod)!;
    await prisma.$executeRawUnsafe(`UPDATE "ClassificacaoProduto" SET "cor" = $1 WHERE id = $2`, cor, linha.id);
  }
  console.log(`Cor preenchida em ${linhas.length} linha(s).`);

  let totalPerdedorasRemovidas = 0;
  for (const g of gruposComMultiplasLinhas) {
    if (g.perdedoras.length === 0) continue;
    const idsPerdedoras = g.perdedoras.map((p) => p.id);
    // Repointa histórico das perdedoras pra vencedora ANTES de deletar — preserva auditoria,
    // nunca perde o rastro de quem mudou o quê (FK é RESTRICT, deletar sem repointar falharia).
    await prisma.classificacaoProdutoHistorico.updateMany({
      where: { classificacaoId: { in: idsPerdedoras } },
      data: { classificacaoId: g.vencedora.id },
    });
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ClassificacaoProduto" WHERE id = ANY($1::text[])`,
      idsPerdedoras
    );
    totalPerdedorasRemovidas += idsPerdedoras.length;
  }
  console.log(`Linhas duplicadas/conflitantes consolidadas (removidas após repointar histórico): ${totalPerdedorasRemovidas}`);

  await prisma.$executeRawUnsafe(
    `UPDATE "ClassificacaoProduto" SET "produtoCor" = produto || '::' || "cor" WHERE "produtoCor" IS NULL`
  );

  const [{ semCor }] = await prisma.$queryRawUnsafe<{ semCor: bigint }[]>(
    `SELECT COUNT(*)::bigint AS "semCor" FROM "ClassificacaoProduto" WHERE "cor" IS NULL`
  );
  const duplicatas = await prisma.$queryRawUnsafe<{ produtoCor: string; n: bigint }[]>(
    `SELECT "produtoCor", COUNT(*)::bigint AS n FROM "ClassificacaoProduto" GROUP BY "produtoCor" HAVING COUNT(*) > 1`
  );
  if (Number(semCor) > 0 || duplicatas.length > 0) {
    console.log(
      `\nABORTADO antes de tornar as colunas definitivas: ${semCor} linha(s) com cor nula, ${duplicatas.length} produtoCor ainda duplicado(s). Isso não deveria acontecer — investigar antes de continuar.`
    );
    process.exitCode = 1;
    return;
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE "ClassificacaoProduto" ALTER COLUMN "cor" SET NOT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ClassificacaoProduto" ALTER COLUMN "produtoCor" SET NOT NULL`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClassificacaoProduto_produtoCor_key" ON "ClassificacaoProduto"("produtoCor")`
  );
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ClassificacaoProduto_produto_idx" ON "ClassificacaoProduto"("produto")`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "ClassificacaoProduto_cod_key"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ClassificacaoProduto" DROP COLUMN "cod"`);

  console.log(`\nConcluído: ClassificacaoProduto agora é por produto+cor. Linhas finais: ${grupos.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
