import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";

// Chamado pelo Vercel Cron às 17h (horário de Brasília). Path separado de /api/sync de propósito
// — ver comentário em src/lib/sync-runner.ts.
export const maxDuration = 800;

export async function GET(request: NextRequest) {
  return handleSyncGet(request);
}

export async function POST(request: NextRequest) {
  return handleSyncPost(request);
}
