import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getGastoDiarioConta } from "@/lib/connectors/meta-ads";
import { getSessoesPorDia } from "@/lib/connectors/google-analytics";

// Diagnóstico temporário READ-ONLY (2026-11-26) — confirmar se Meta Ads/GA4 respondem de
// verdade em produção (suspeita: token Meta Ads de 60 dias expirado). Remover depois.
export const maxDuration = 30;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.DIAG_MKT_SECRET && secret === process.env.DIAG_MKT_SECRET;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const hoje = new Date().toISOString().slice(0, 10);
  const seteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const resultado: Record<string, unknown> = {};

  try {
    const metaResult = await getGastoDiarioConta(seteDiasAtras, hoje);
    resultado.metaAds = { ok: true, totalDias: metaResult.size };
  } catch (e) {
    resultado.metaAds = { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  try {
    const ga4Result = await getSessoesPorDia({ since: seteDiasAtras, until: hoje });
    resultado.ga4 = { ok: true, totalDias: ga4Result.length };
  } catch (e) {
    resultado.ga4 = { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(resultado);
}
