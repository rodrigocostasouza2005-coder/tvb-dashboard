import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { hasTabAccess } from "@/lib/tabs";
import { prisma } from "@/lib/prisma";
import { getNotaFiscalInfo } from "@/lib/connectors/nota-fiscal";
import { resolveClienteVariantes } from "@/lib/metrics";

// Número + chave de acesso de UMA nota fiscal, buscados ao vivo no DAPIC (com cache permanente em
// NotaFiscalCache, ver getNotaFiscalInfo) — chamado pelo client component da lista de Notas
// Fiscais da Ficha do Cliente (ver notas-fiscais-cliente.tsx), 1 vez por nota exibida, não no load
// da página inteira. Pedido original do Rodrigo em 2026-11-11: não travar a página carregando N
// chamadas sequenciais ao DAPIC — cada linha resolve a própria chave/número de forma assíncrona.
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasTabAccess(user, "clientes-ficha", user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cliente = request.nextUrl.searchParams.get("cliente");
  const storeId = request.nextUrl.searchParams.get("storeId");
  const dapicVendaIdRaw = request.nextUrl.searchParams.get("dapicVendaId");
  const dapicVendaId = dapicVendaIdRaw !== null ? Number(dapicVendaIdRaw) : NaN;
  if (!cliente || !storeId || !Number.isFinite(dapicVendaId)) {
    return NextResponse.json({ error: "parâmetros inválidos" }, { status: 400 });
  }

  const variantes = await resolveClienteVariantes(cliente);
  if (variantes.length === 0) return NextResponse.json({ error: "cliente não encontrado" }, { status: 404 });

  // Trava de verdade (não só esconder na UI): o pedido (storeId+dapicVendaId) precisa pertencer
  // a ESSE cliente, senão qualquer usuário logado poderia sondar nota fiscal de qualquer venda só
  // trocando o storeId/dapicVendaId na URL — mesmo que o número/chave em si não seja PII sensível,
  // é dado de outra venda que não devia vir por essa rota.
  const pertence = await prisma.sale.findFirst({
    where: { storeId, dapicVendaId, clienteNome: { in: variantes } },
    select: { id: true },
  });
  if (!pertence) return NextResponse.json({ error: "nota não pertence a esse cliente" }, { status: 403 });

  const info = await getNotaFiscalInfo(storeId, dapicVendaId);
  return NextResponse.json(info);
}
