import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPromotionResultadoReal } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { brasiliaDayStart, brasiliaDayEnd } from "@/lib/filters";

// Busca sob demanda (botão "Ver resultado real" na Análises de Promoção) — pedido do Rodrigo em
// 2026-09-28: depois de uma campanha acontecer, comparar receita real do período com a receita
// potencial que foi projetada antes. Período/filtro vêm da tela, não recarrega a página.
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const fromStr = params.get("from");
  const toStr = params.get("to");
  if (!fromStr || !toStr) return NextResponse.json({ error: "from e to obrigatórios" }, { status: 400 });

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);

  const colecao = params.get("colecao") || undefined;
  const grupo = params.get("grupo") || undefined;
  // Trava de verdade — usuário restrito não consegue puxar resultado de um grupo que não tem
  // liberado nem chamando a rota direto.
  if (grupo && grupoIn && !grupoIn.includes(grupo)) {
    return NextResponse.json({ error: "grupo não permitido" }, { status: 403 });
  }
  const produto = params.get("produto") || undefined;

  const resultado = await getPromotionResultadoReal({
    from: brasiliaDayStart(fromStr),
    to: brasiliaDayEnd(toStr),
    storeIds: allowedStores,
    grupoIn,
    colecao,
    grupo,
    produto,
  });

  return NextResponse.json(resultado);
}
