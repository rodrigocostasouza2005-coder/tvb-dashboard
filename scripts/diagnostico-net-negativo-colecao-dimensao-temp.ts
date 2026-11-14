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
 *
 * Hipótese adicional (achada relendo getSalesByDayPerStore, vendas.ts:244-280): a query de Sale
 * filtra por "marca" = ANY(filters.marcas) e "tabelaPreco" = ANY(filters.tabelasPreco), mas a
 * query de Return NÃO filtra por nenhum dos dois (comentário no código: Return não tem marca/
 * tabelaPreco confiáveis). getMarcaRestriction(user) devolve user.allowedMarcas CRU (nunca
 * undefined), e parseFilters/crossWithAllowed trata um array vazio [] como restrição real
 * "nada liberado" quando o usuário não escolheu nada no filtro — ou seja, se allowedMarcas (ou
 * allowedTabelasPreco, já sem "Tabela atacado") não cobrir 100% dos valores reais de marca/
 * tabelaPreco presentes no período, a Sale pode ficar artificialmente zerada/reduzida enquanto
 * a Return continua contando tudo — produzindo negativo sem nenhuma venda/devolução órfã ou
 * duplicada de verdade. Testa isso recomputando o líquido de Barra/Leblon/Rio Sul no dia 10/11
 * com os mesmos filtros de marca/tabelaPreco de cada usuário ADMIN/GESTAO real (só leitura de
 * email/role/allowedMarcas/allowedTabelasPreco — nunca passwordHash).
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

  // === 4) Hipótese do filtro assimétrico marca/tabelaPreco (Sale filtra, Return não) ===
  // Reproduz exatamente a lógica de getMarcaRestriction/getTabelaPrecoRestrictionSemAtacado +
  // crossWithAllowed pra cada usuário real, e recalcula o líquido de Barra/Leblon/Rio Sul no dia
  // 10/11 (o dia do print) com esse filtro aplicado só na Sale, igual o código de produção faz.
  console.log("\n=== Teste da hipótese: filtro de marca/tabelaPreco assimétrico (Sale filtra, Return não) ===");
  const usuarios = await prisma.user.findMany({
    select: { email: true, role: true, allowedMarcas: true, allowedTabelasPreco: true },
  });
  console.log(`${usuarios.length} usuário(s) encontrado(s).`);

  const lojasFisicas = await prisma.store.findMany({
    where: {
      OR: [
        { name: { contains: "Leblon", mode: "insensitive" } },
        { name: { contains: "Barra", mode: "insensitive" } },
        { name: { contains: "Rio Sul", mode: "insensitive" } },
      ],
      sellsProducts: true,
    },
    select: { id: true, name: true },
  });

  const DIA_PRINT_INICIO = new Date("2026-11-10T00:00:00.000-03:00");
  const DIA_PRINT_FIM = new Date("2026-11-10T23:59:59.999-03:00");

  for (const u of usuarios) {
    // Mesma regra de getTabelaPrecoRestrictionSemAtacado: tira "Tabela atacado" da lista crua.
    const tabelasSemAtacado = u.allowedTabelasPreco.filter((t) => t !== "Tabela atacado");
    // crossWithAllowed(chosen=[], allowed=<array cru>) => sempre devolve o array cru quando o
    // usuário não escolheu nada no filtro (é sempre o caso aqui, testando o estado "sem filtro
    // manual" — exatamente o que o print mostra, accordion de Filtros fechado/default).
    const marcasFiltro = u.allowedMarcas; // já é array cru, nunca undefined
    const tabelasFiltro = tabelasSemAtacado;

    console.log(`\n--- Usuário ${u.email} (${u.role}) | allowedMarcas=${JSON.stringify(u.allowedMarcas)} | allowedTabelasPreco(sem atacado)=${JSON.stringify(tabelasSemAtacado)} ---`);

    for (const loja of lojasFisicas) {
      // Sale: aplica os mesmos filtros de marca/tabelaPreco do usuário (array vazio = zero linhas,
      // igual "marca" = ANY(ARRAY[]::text[]) no SQL real). tabelaPreco = ANY(tabelasFiltro) OR
      // tabelaPreco IS NULL — replica o "OR tabelaPreco IS NULL" do SQL real.
      const saleAgg = await prisma.sale.aggregate({
        where: {
          storeId: loja.id,
          status: { not: "Cancelada" },
          saleDate: { gte: DIA_PRINT_INICIO, lte: DIA_PRINT_FIM },
          marca: { in: marcasFiltro },
          OR: [{ tabelaPreco: { in: tabelasFiltro } }, { tabelaPreco: null }],
        },
        _sum: { quantidade: true },
      });
      // Return: SEM nenhum filtro de marca/tabelaPreco, igual o código real.
      const returnAgg = await prisma.return.aggregate({
        where: { storeId: loja.id, status: { not: "Cancelada" }, returnDate: { gte: DIA_PRINT_INICIO, lte: DIA_PRINT_FIM } },
        _sum: { quantidade: true },
      });
      const vendido = saleAgg._sum.quantidade ?? 0;
      const devolvido = returnAgg._sum.quantidade ?? 0;
      const liquido = vendido - devolvido;
      console.log(`  ${loja.name} | vendido(com filtro)=${vendido} devolvido(sem filtro)=${devolvido} liquido=${liquido}${liquido < 0 ? "  <<< NEGATIVO" : ""}`);
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
