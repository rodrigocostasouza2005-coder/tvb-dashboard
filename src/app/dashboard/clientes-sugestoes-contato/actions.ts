"use server";

import { getSessionUser, getVendedorAtualCookie, setVendedorAtualCookie } from "@/lib/auth";
import { getStoreRestriction } from "@/lib/permissions";
import { getVendedores } from "@/lib/metrics";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export type ContatoTipo = "sugestao" | "followup";

// Nome de quem registra o contato: o vendedor selecionado na tela (validado contra a lista de
// vendedores da loja do login — nunca confia no cookie sozinho, ver getVendedorAtualCookie), ou
// o nome do login da loja como fallback pra quem não passa por essa seleção (ADMIN/GESTÃO, que
// continuam vendo/contatando normalmente sem escolher vendedor). Pedido do Rodrigo em 2026-09-18.
async function resolverContatadoPor(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>): Promise<string> {
  const cookieVendedor = await getVendedorAtualCookie();
  if (!cookieVendedor) return user.name;
  const permitidos = await getVendedores(getStoreRestriction(user));
  return permitidos.includes(cookieVendedor) ? cookieVendedor : user.name;
}

export async function marcarContatadoAction(tipo: ContatoTipo, cliente: string, chave: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");
  const contatadoPor = await resolverContatadoPor(user);

  const rec = await prisma.contatoMarcado.upsert({
    where: { tipo_cliente_chave: { tipo, cliente, chave } },
    create: { tipo, cliente, chave, contatadoPor },
    update: { contatadoPor, contatadoEm: new Date() },
  });
  revalidatePath("/dashboard/clientes-sugestoes-contato");
  return { contatadoPor: rec.contatadoPor, contatadoEm: rec.contatadoEm.toISOString() };
}

// Seleção/troca do vendedor atual, dentro do login da loja — validado contra a lista real de
// vendedores daquela loja (Sale.vendedor dentro de allowedStores), pra ninguém conseguir gravar
// um nome arbitrário mexendo direto na requisição. Ver requireTabAccess/getStoreRestriction pro
// mesmo espírito de validação já usado nos outros filtros do app.
export async function selecionarVendedorAction(nome: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");
  const permitidos = await getVendedores(getStoreRestriction(user));
  if (!permitidos.includes(nome)) throw new Error("Vendedor não pertence a essa loja.");
  await setVendedorAtualCookie(nome);
  revalidatePath("/dashboard/clientes-sugestoes-contato");
}

export async function desmarcarContatadoAction(tipo: ContatoTipo, cliente: string, chave: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");

  await prisma.contatoMarcado.deleteMany({ where: { tipo, cliente, chave } });
  revalidatePath("/dashboard/clientes-sugestoes-contato");
}
