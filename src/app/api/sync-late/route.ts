import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";

// Chamado pelo Vercel Cron às 18h30 (horário de Brasília) — 3º horário de segurança.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return handleSyncGet(request);
}

export async function POST(request: NextRequest) {
  return handleSyncPost(request);
}
