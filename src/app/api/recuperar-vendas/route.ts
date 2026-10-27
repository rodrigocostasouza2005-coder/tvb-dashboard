import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { recuperarVendasRecentes } from "@/lib/sync-runner";

// Rota de recuperação pontual (2026-10-27, ver recuperarVendasRecentes em sync-runner.ts) —
// mesmo segredo/contrato de /api/sync-frequent (EXTERNAL_SYNC_SECRET + header x-sync-secret, não
// CRON_SECRET, que é "Sensitive" na Vercel e não pode ser lido de volta). Pensada pra ser chamada
// via GitHub Actions (secrets.EXTERNAL_SYNC_SECRET), não por um navegador — não precisa de sessão
// admin. dias vem por query string (?dias=10), default 10 (gap confirmado de ~5-6 dias + margem).
export const maxDuration = 300;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.EXTERNAL_SYNC_SECRET && secret === process.env.EXTERNAL_SYNC_SECRET;
}

async function handle(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const diasRaw = new URL(request.url).searchParams.get("dias");
  const dias = diasRaw ? Number(diasRaw) : 10;
  const resultado = await recuperarVendasRecentes(Number.isFinite(dias) && dias > 0 ? dias : 10);
  return NextResponse.json(resultado);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
