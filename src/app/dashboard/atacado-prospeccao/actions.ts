"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function criarProspectAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  requireTabAccess(user, user.role, "atacado-prospeccao");

  const nomeFantasia = value(formData, "nomeFantasia");
  const cnpjRaw = value(formData, "cnpj");
  const cnpj = cnpjRaw ? cnpjRaw.replace(/\D/g, "") : null;
  const estado = value(formData, "estado").toUpperCase();
  const site = value(formData, "site");
  const evidenciaUrl = value(formData, "evidenciaUrl");

  if (!nomeFantasia) redirect("/dashboard/atacado-prospeccao?erro=nome");
  if (cnpj && cnpj.length !== 14) redirect("/dashboard/atacado-prospeccao?erro=cnpj");
  if (estado && !/^[A-Z]{2}$/.test(estado)) redirect("/dashboard/atacado-prospeccao?erro=estado");

  try {
    const prospect = await prisma.atacadoProspect.create({
      data: {
        nomeFantasia,
        razaoSocial: value(formData, "razaoSocial") || null,
        cnpj,
        cidade: value(formData, "cidade") || null,
        estado: estado || null,
        site: site || null,
        telefone: value(formData, "telefone") || null,
        email: value(formData, "email") || null,
        origem: value(formData, "origem") || "manual",
        evidenciaUrl: evidenciaUrl || null,
        observacoes: value(formData, "observacoes") || null,
        criadoPor: user.name,
        activities: {
          create: {
            tipo: "CADASTRO",
            descricao: "Prospecto cadastrado manualmente",
            criadoPor: user.name,
          },
        },
      },
    });
    revalidatePath("/dashboard/atacado-prospeccao");
    redirect(`/dashboard/atacado-prospeccao?criado=${prospect.id}`);
  } catch (error) {
    // Prisma P2002 = CNPJ já cadastrado. Não expor detalhes internos ao usuário.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      redirect("/dashboard/atacado-prospeccao?erro=duplicado");
    }
    throw error;
  }
}
