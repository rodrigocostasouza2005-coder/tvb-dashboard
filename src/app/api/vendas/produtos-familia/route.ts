import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMonthlySalesByProduto, getDistinctProdutosPorGrupo, type DashboardFilters } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";

// Drilldown Família → Produto da seção "Vendas mensais por família" (/dashboard/vendas) — busca
// sob demanda, chamada pelo client component quando o usuário escolhe uma família na visão
// Produto. Pedido do Rodrigo em 2026-09-25: interação local não deve refazer a página inteira
// (as outras ~15 queries dessa página, que não mudam com a escolha de produto) — só essa busca
// pontual, direto do navegador.
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const familia = request.nextUrl.searchParams.get("familia");
  if (!familia) return NextResponse.json({ error: "familia obrigatória" }, { status: 400 });

  const grupoIn = await getGrupoRestriction(user.role);
  // Trava de verdade (não só esconder na UI) — usuário restrito que não tem essa família liberada
  // não consegue puxar o drilldown dela nem chamando a rota direto.
  if (grupoIn && !grupoIn.includes(familia)) {
    return NextResponse.json({ error: "família não permitida" }, { status: 403 });
  }

  const rawParams: RawSearchParams = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key === "familia") continue;
    const existing = rawParams[key];
    if (existing === undefined) rawParams[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else rawParams[key] = [existing, value];
  }

  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  // Mesma regra da página: "Tabela atacado" não entra na aba Vendas (mãe).
  const allowedTabelasPreco = getTabelaPrecoRestriction(user).filter((t) => t !== "Tabela atacado");
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };
  // Histórico completo, mesmo padrão da visão por família nessa seção.
  const historicoFilters: DashboardFilters = { ...filters, from: new Date("2020-01-01"), to: new Date() };

  const [produtos, porProduto] = await Promise.all([
    getDistinctProdutosPorGrupo(filters, familia),
    getMonthlySalesByProduto(historicoFilters, familia),
  ]);

  return NextResponse.json({ produtos, data: porProduto.data, series: porProduto.series });
}
