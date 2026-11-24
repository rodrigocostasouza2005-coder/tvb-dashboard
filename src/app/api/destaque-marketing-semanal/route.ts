import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDestaqueMarketingSemanal } from "@/lib/metrics/destaque-marketing-semanal";

// Rota de leitura pra automação externa (pedido do Rodrigo, 2026-11-24) — PRIMEIRA metade de um
// agente semanal de destaque de marketing/criativo/stories (a rotina que de fato dispara o aviso é
// configurada depois, fora deste arquivo). Mesmo contrato EXATO de /api/recuperar-vendas: secret
// em EXTERNAL_SYNC_SECRET (não CRON_SECRET, que é "Sensitive" na Vercel e não pode ser lido de
// volta), header x-sync-secret, pensada pra ser chamada por um job/automação, não por navegador.
//
// GET apenas, de propósito: esta rota só LÊ dado já sincronizado (getDestaqueMarketingSemanal não
// escreve nada no banco) — nunca precisa de POST.
export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.EXTERNAL_SYNC_SECRET && secret === process.env.EXTERNAL_SYNC_SECRET;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const produtos = await getDestaqueMarketingSemanal();
  return NextResponse.json({ geradoEm: new Date().toISOString(), total: produtos.length, produtos });
}
