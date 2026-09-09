"use server";

import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export type ContatoTipo = "sugestao" | "followup";

export async function marcarContatadoAction(tipo: ContatoTipo, cliente: string, chave: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");

  const rec = await prisma.contatoMarcado.upsert({
    where: { tipo_cliente_chave: { tipo, cliente, chave } },
    create: { tipo, cliente, chave, contatadoPor: user.name },
    update: { contatadoPor: user.name, contatadoEm: new Date() },
  });
  revalidatePath("/dashboard/clientes-sugestoes-contato");
  return { contatadoPor: rec.contatadoPor, contatadoEm: rec.contatadoEm.toISOString() };
}

export async function desmarcarContatadoAction(tipo: ContatoTipo, cliente: string, chave: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");

  await prisma.contatoMarcado.deleteMany({ where: { tipo, cliente, chave } });
  revalidatePath("/dashboard/clientes-sugestoes-contato");
}
