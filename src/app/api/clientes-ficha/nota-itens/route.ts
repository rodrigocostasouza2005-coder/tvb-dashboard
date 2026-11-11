import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { hasTabAccess } from "@/lib/tabs";
import { getClienteNotaItens, resolveClienteVariantes } from "@/lib/metrics";

// Produtos de UMA nota fiscal específica (storeId + dapicVendaId), buscados sob demanda — chamado
// pelo client component só no 1º expand de cada nota na lista de Notas Fiscais da Ficha do
// Cliente (ver notas-fiscais-cliente.tsx). Pedido original do Rodrigo em 2026-11-11: não carregar
// itens de TODAS as notas de uma vez, só da que foi expandida.
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

  // getClienteNotaItens já filtra por clienteNome IN variantes — não devolve item de nenhuma
  // outra venda, mesmo que o storeId/dapicVendaId pedido não seja desse cliente (nesse caso só
  // vem lista vazia, sem vazar dado de outro cliente).
  const itens = await getClienteNotaItens(variantes, storeId, dapicVendaId);
  return NextResponse.json({ itens });
}
