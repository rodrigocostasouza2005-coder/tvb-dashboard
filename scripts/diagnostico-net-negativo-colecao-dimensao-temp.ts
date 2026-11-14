/**
 * Diagnóstico temporário, SOMENTE LEITURA — continuação da investigação de "unidades líquidas
 * negativas" (ver diagnostico-net-negativo-lojas-fisicas-temp.ts, PR #95: zero bucket negativo
 * por LOJA em 2026-11-10..hoje). Agora testa as outras duas telas onde "(unidades líquidas)"
 * aparece: "Comparativo por coleção" (Visão Geral e Vendas, getSalesByDayPerColecao) e o
 * agregado por dimensão (Top mais/menos vendidos, netByReturns por grupo/produto/tamanho/
 * colecao) — sem filtro de loja/marca/tabelaPreco, mesmo período.
 *
 * Hipótese testada: "colecao" é campo de texto opcional em Sale e Return, historicamente com
 * bug de Return ficando colecao=null mesmo quando a Sale original tem colecao preenchida
 * (comentário em prisma/schema.prisma, model Return — corrigido pra upsert em 2026-10-01, mas
 * dado antigo pode continuar null). Se o bucket negativo for concentrado em "(sem coleção)",
 * é esse mismatch. Se for uma coleção nomeada, pode ser só efeito normal de janela curta
 * (devolução no período de uma venda de FORA do período) — não necessariamente bug.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FROM = new Date("2026-11-10T00:00:00Z");

function toDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const hoje = new Date();
  console.log(`Período: ${toDayKey(FROM)} até ${toDayKey(hoje)} (hora da execução do workflow), sem filtro de loja/marca/tabelaPreco/grupo.`);

  // === 1) Mesma lógica de getSalesByDayPerColecao, dia a dia ===
  const salesByColecao = await prisma.sale.groupBy({
    by: ["colecao"],
    where: { status: { not: "Cancelada" }, saleDate: { gte: FROM, lte: hoje } },
    _sum: { quantidade: true },
  });
  const returnsByColecao = await prisma.return.groupBy({
    by: ["colecao"],
    where: { status: { not: "Cancelada" }, returnDate: { gte: FROM, lte: hoje } },
    _sum: { quantidade: true },
  });

  console.log("\n=== Agregado do período inteiro por coleção (vendido vs devolvido) ===");
  const colecaoKeys = new Set<string>();
  for (const r of salesByColecao) colecaoKeys.add(r.colecao?.trim() || "(sem coleção)");
  for (const r of returnsByColecao) colecaoKeys.add(r.colecao?.trim() || "(sem coleção)");
  const vendidoByColecao = new Map<string, number>();
  for (const r of salesByColecao) {
    const k = r.colecao?.trim() || "(sem coleção)";
    vendidoByColecao.set(k, (vendidoByColecao.get(k) ?? 0) + (r._sum.quantidade ?? 0));
  }
  const devolvidoByColecao = new Map<string, number>();
  for (const r of returnsByColecao) {
    const k = r.colecao?.trim() || "(sem coleção)";
    devolvidoByColecao.set(k, (devolvidoByColecao.get(k) ?? 0) + (r._sum.quantidade ?? 0));
  }
  for (const k of [...colecaoKeys].sort()) {
    const vendido = vendidoByColecao.get(k) ?? 0;
    const devolvido = devolvidoByColecao.get(k) ?? 0;
    const liquido = vendido - devolvido;
    console.log(`${k} | vendido=${vendido} devolvido=${devolvido} liquido=${liquido}${liquido < 0 ? "  <<< NEGATIVO" : ""}`);
  }

  // === 2) Dia a dia por coleção (igual o gráfico real) ===
  const salesRowsDia = await prisma.$queryRaw<{ day: Date; colecao: string | null; units: bigint }[]>`
    SELECT (("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day, "colecao", SUM("quantidade") AS units
    FROM "Sale" WHERE "status" != 'Cancelada' AND "saleDate" >= ${FROM} AND "saleDate" <= ${hoje}
    GROUP BY day, "colecao" ORDER BY day ASC
  `;
  const returnRowsDia = await prisma.$queryRaw<{ day: Date; colecao: string | null; units: bigint }[]>`
    SELECT (("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day, "colecao", SUM("quantidade") AS units
    FROM "Return" WHERE "status" != 'Cancelada' AND "returnDate" >= ${FROM} AND "returnDate" <= ${hoje}
    GROUP BY day, "colecao" ORDER BY day ASC
  `;
  type Bucket = { vendido: number; devolvido: number };
  const byDayColecao = new Map<string, Bucket>();
  for (const r of salesRowsDia) {
    const k = `${toDayKey(r.day)}::${r.colecao?.trim() || "(sem coleção)"}`;
    const cur = byDayColecao.get(k) ?? { vendido: 0, devolvido: 0 };
    cur.vendido += Number(r.units);
    byDayColecao.set(k, cur);
  }
  for (const r of returnRowsDia) {
    const k = `${toDayKey(r.day)}::${r.colecao?.trim() || "(sem coleção)"}`;
    const cur = byDayColecao.get(k) ?? { vendido: 0, devolvido: 0 };
    cur.devolvido += Number(r.units);
    byDayColecao.set(k, cur);
  }
  console.log("\n=== Dia a dia por coleção (só os negativos) ===");
  let countNeg = 0;
  for (const [k, b] of [...byDayColecao.entries()].sort()) {
    const liquido = b.vendido - b.devolvido;
    if (liquido < 0) {
      countNeg++;
      console.log(`${k} | vendido=${b.vendido} devolvido=${b.devolvido} liquido=${liquido}`);
    }
  }
  console.log(`Total de dia/coleção negativos: ${countNeg}`);

  // === 3) Agregado do período por GRUPO, PRODUTO e TAMANHO (netByReturns-equivalente) ===
  for (const dim of ["grupo", "produto", "tamanho"] as const) {
    const salesAgg = await prisma.sale.groupBy({
      by: [dim],
      where: { status: { not: "Cancelada" }, saleDate: { gte: FROM, lte: hoje } },
      _sum: { quantidade: true },
    });
    const returnsAgg = await prisma.return.groupBy({
      by: [dim],
      where: { status: { not: "Cancelada" }, returnDate: { gte: FROM, lte: hoje } },
      _sum: { quantidade: true },
    });
    const vendidoMap = new Map<string, number>();
    for (const r of salesAgg) {
      const k = (r as Record<string, unknown>)[dim] as string | null;
      vendidoMap.set(k?.trim() || "(vazio)", (vendidoMap.get(k?.trim() || "(vazio)") ?? 0) + (r._sum.quantidade ?? 0));
    }
    const devolvidoMap = new Map<string, number>();
    for (const r of returnsAgg) {
      const k = (r as Record<string, unknown>)[dim] as string | null;
      devolvidoMap.set(k?.trim() || "(vazio)", (devolvidoMap.get(k?.trim() || "(vazio)") ?? 0) + (r._sum.quantidade ?? 0));
    }
    const allKeys = new Set([...vendidoMap.keys(), ...devolvidoMap.keys()]);
    const negativos = [...allKeys]
      .map((k) => ({ k, vendido: vendidoMap.get(k) ?? 0, devolvido: devolvidoMap.get(k) ?? 0, liquido: (vendidoMap.get(k) ?? 0) - (devolvidoMap.get(k) ?? 0) }))
      .filter((r) => r.liquido < 0)
      .sort((a, b) => a.liquido - b.liquido);
    console.log(`\n=== Agregado do período por ${dim} — ${negativos.length} valor(es) negativo(s) de ${allKeys.size} total ===`);
    for (const r of negativos.slice(0, 30)) {
      console.log(`${dim}="${r.k}" | vendido=${r.vendido} devolvido=${r.devolvido} liquido=${r.liquido}`);
    }
  }

  console.log("\n=== Fim do diagnóstico ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
