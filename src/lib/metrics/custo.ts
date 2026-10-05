import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { saleWhere, returnWhere, cacheAsync, FILTER_LIST_CACHE_MS, type DashboardFilters } from "./core";

// Custo unitário por SKU (StockSnapshot.valorCusto) — auditoria de 2026-10-05: é a ÚNICA fonte
// de custo real no Radar. Sale.valorCustoTotal existe no schema mas NUNCA é populado pelo sync
// (sempre null, confirmado por grep — zero gravação em qualquer lugar do código), então não pode
// ser usado. StockSnapshot é upsert (1 linha por storeId+cod, sobrescrita a cada sync, ver
// comentário no schema) — só existe o custo ATUAL de cada SKU, nunca o custo histórico de quando
// a venda aconteceu. Por isso todo CMV calculado a partir daqui é "CMV estimado" (aplica o custo
// de HOJE a vendas de qualquer data do período), nunca "CMV real"/contábil — documentado nas
// funções abaixo e exposto como tal na UI. Confirmado em dev (2026-10-05, 2675 SKUs): valorCusto
// NUNCA diverge entre lojas pro mesmo cod, por isso a busca abaixo ignora loja.
export async function getCustoUnitarioPorCod(): Promise<Map<string, number>> {
  return cacheAsync("custo-unitario-por-cod", FILTER_LIST_CACHE_MS, async () => {
    const rows = await prisma.stockSnapshot.findMany({
      distinct: ["cod"],
      select: { cod: true, valorCusto: true },
      where: { valorCusto: { not: null } },
    });
    return new Map(rows.map((r) => [r.cod, r.valorCusto as number]));
  });
}

export type CmvPorGrupoRow = { key: string; cmv: number; unidadesSemCusto: number };

// CMV estimado por família (grupo): unidades vendidas LÍQUIDAS (venda − devolução, cancelamento
// já excluído via saleWhere/returnWhere — mesma regra usada em netByReturns no resto do Radar,
// só que aqui no nível de SKU em vez de família, pra poder aplicar o custo unitário certo de
// cada peça antes de somar por família) × custo unitário atual do SKU. SKU vendido que nunca
// apareceu em nenhum snapshot de estoque fica de fora do CMV (não assume custo 0, que
// subestimaria o CMV) — a quantidade correspondente volta em `unidadesSemCusto` pra UI avisar.
export async function getCmvPorGrupo(filters: DashboardFilters): Promise<CmvPorGrupoRow[]> {
  const [vendidoPorCod, devolvidoPorCod, custoPorCod] = await Promise.all([
    prisma.sale.groupBy({ by: ["cod", "grupo"], where: saleWhere(filters), _sum: { quantidade: true } }),
    prisma.return.groupBy({ by: ["cod"], where: returnWhere(filters), _sum: { quantidade: true } }),
    getCustoUnitarioPorCod(),
  ]);
  const devolvidoMap = new Map(devolvidoPorCod.map((r) => [r.cod, r._sum.quantidade ?? 0]));

  const porGrupo = new Map<string, { cmv: number; unidadesSemCusto: number }>();
  for (const v of vendidoPorCod) {
    const liquido = (v._sum.quantidade ?? 0) - (devolvidoMap.get(v.cod) ?? 0);
    if (liquido <= 0) continue;
    const acc = porGrupo.get(v.grupo) ?? { cmv: 0, unidadesSemCusto: 0 };
    const custoUnit = custoPorCod.get(v.cod);
    if (custoUnit === undefined) acc.unidadesSemCusto += liquido;
    else acc.cmv += liquido * custoUnit;
    porGrupo.set(v.grupo, acc);
  }
  return [...porGrupo.entries()].map(([key, v]) => ({ key, cmv: v.cmv, unidadesSemCusto: v.unidadesSemCusto }));
}

// Evolução mensal do CMV estimado, restrita a um conjunto de famílias (evita gráfico com dezenas
// de séries — mesmo espírito do "top 5" já usado em Vendas/família). Aproximação deliberada,
// diferente de getCmvPorGrupo: usa unidades BRUTAS por mês (só exclui cancelada, não desconta
// devolução mês a mês) — mesmo padrão já usado nos gráficos mensais existentes
// (getMonthlySalesByColuna em vendas.ts), que também não reconciliam devolução por mês na série,
// só no total do período. O KPI/tabela/ranking desta página usam o CMV líquido de devolução
// (getCmvPorGrupo); só esta série de evolução usa a aproximação mensal.
export async function getCmvMensalPorGrupo(filters: DashboardFilters, gruposIn: string[]): Promise<{ month: string; grupo: string; cmv: number }[]> {
  if (gruposIn.length === 0) return [];
  const custoPorCod = await getCustoUnitarioPorCod();

  const rows = await prisma.$queryRaw<{ month: Date; cod: string; grupo: string; units: bigint }[]>`
    SELECT
      DATE_TRUNC('month', ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS month,
      "cod", "grupo",
      SUM("quantidade") AS units
    FROM "Sale"
    WHERE "status" != 'Cancelada'
      AND "saleDate" >= ${filters.from}
      AND "saleDate" <= ${filters.to}
      AND "grupo" = ANY(${gruposIn})
      ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
      ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
      ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
      ${filters.colecaoIn ? Prisma.sql`AND "colecao" = ANY(${filters.colecaoIn})` : Prisma.empty}
    GROUP BY month, "cod", "grupo"
  `;

  const byMonthGrupo = new Map<string, number>();
  for (const r of rows) {
    const custoUnit = custoPorCod.get(r.cod);
    if (custoUnit === undefined) continue;
    const monthStr = new Date(r.month).toISOString().slice(0, 7);
    const mapKey = `${monthStr}\x00${r.grupo}`;
    byMonthGrupo.set(mapKey, (byMonthGrupo.get(mapKey) ?? 0) + Number(r.units) * custoUnit);
  }

  return [...byMonthGrupo.entries()].map(([mapKey, cmv]) => {
    const [month, grupo] = mapKey.split("\x00");
    return { month, grupo, cmv };
  });
}
