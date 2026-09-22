"use server";

import { getSessionUser, getVendedorAtualCookie, setVendedorAtualCookie } from "@/lib/auth";
import { getStoreRestriction } from "@/lib/permissions";
import { getVendedoresAtivos } from "@/lib/metrics";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export type ContatoTipo = "sugestao" | "followup";

// Nome de quem registra o contato: o vendedor selecionado na tela (validado contra a lista de
// vendedores ATIVOS da loja do login — nunca confia no cookie sozinho, ver
// getVendedorAtualCookie; vendedor inativo não pode mais virar contatadoPor, pedido do Rodrigo
// em 2026-09-21), ou o nome do login da loja como fallback pra quem não passa por essa seleção
// (ADMIN/GESTÃO, que continuam vendo/contatando normalmente sem escolher vendedor). storeId só
// sai preenchido em login de loja única — em fallback multi-loja não dá pra atribuir a 1 loja só,
// fica null (ver getContatosPorVendedor, que exclui null quando quem vê é de loja única).
async function resolverContatadoPor(
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>
): Promise<{ contatadoPor: string; storeId: string | null }> {
  const allowedStores = getStoreRestriction(user);
  const storeIdLojaUnica = allowedStores.length === 1 ? allowedStores[0] : null;

  const cookieVendedor = await getVendedorAtualCookie();
  if (!cookieVendedor || !storeIdLojaUnica) return { contatadoPor: user.name, storeId: storeIdLojaUnica };
  const permitidos = await getVendedoresAtivos(storeIdLojaUnica);
  return permitidos.includes(cookieVendedor)
    ? { contatadoPor: cookieVendedor, storeId: storeIdLojaUnica }
    : { contatadoPor: user.name, storeId: storeIdLojaUnica };
}

export async function marcarContatadoAction(tipo: ContatoTipo, cliente: string, chave: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");
  const { contatadoPor, storeId } = await resolverContatadoPor(user);

  const rec = await prisma.contatoMarcado.upsert({
    where: { tipo_cliente_chave: { tipo, cliente, chave } },
    create: { tipo, cliente, chave, contatadoPor, storeId },
    update: { contatadoPor, storeId, contatadoEm: new Date() },
  });
  revalidatePath("/dashboard/clientes-sugestoes-contato");
  return { contatadoPor: rec.contatadoPor, contatadoEm: rec.contatadoEm.toISOString() };
}

// Seleção/troca do vendedor atual, dentro do login da loja — validado contra a lista real de
// vendedores ATIVOS daquela loja, pra ninguém conseguir gravar um nome arbitrário (ou um
// vendedor inativo/de outra loja) mexendo direto na requisição. Ver
// requireTabAccess/getStoreRestriction pro mesmo espírito de validação já usado nos outros
// filtros do app.
export async function selecionarVendedorAction(nome: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");
  const allowedStores = getStoreRestriction(user);
  if (allowedStores.length !== 1) throw new Error("Login sem loja única — não é possível selecionar vendedor.");
  const permitidos = await getVendedoresAtivos(allowedStores[0]);
  if (!permitidos.includes(nome)) throw new Error("Vendedor não pertence a essa loja ou está inativo.");
  await setVendedorAtualCookie(nome);
  revalidatePath("/dashboard/clientes-sugestoes-contato");
}

export async function desmarcarContatadoAction(tipo: ContatoTipo, cliente: string, chave: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");

  await prisma.contatoMarcado.deleteMany({ where: { tipo, cliente, chave } });
  revalidatePath("/dashboard/clientes-sugestoes-contato");
}
