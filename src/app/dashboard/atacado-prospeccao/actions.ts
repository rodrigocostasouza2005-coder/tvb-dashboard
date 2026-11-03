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


const STATUS_VALIDOS = new Set([
  "NOVO",
  "EM_QUALIFICACAO",
  "QUALIFICADO",
  "CONTATADO",
  "NEGOCIACAO",
  "CONVERTIDO",
  "DESCARTADO",
]);

export async function atualizarStatusProspectAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  requireTabAccess(user, user.role, "atacado-prospeccao");

  const prospectId = value(formData, "prospectId");
  const novoStatus = value(formData, "status");
  if (!prospectId || !STATUS_VALIDOS.has(novoStatus)) {
    redirect("/dashboard/atacado-prospeccao?erro=status");
  }

  const atual = await prisma.atacadoProspect.findUnique({
    where: { id: prospectId },
    select: { id: true, status: true, nomeFantasia: true },
  });
  if (!atual) redirect("/dashboard/atacado-prospeccao?erro=nao-encontrado");
  if (atual.status === novoStatus) redirect("/dashboard/atacado-prospeccao");

  await prisma.$transaction([
    prisma.atacadoProspect.update({
      where: { id: prospectId },
      data: { status: novoStatus },
    }),
    prisma.atacadoProspectActivity.create({
      data: {
        prospectId,
        tipo: "STATUS",
        descricao: `Status alterado de ${atual.status} para ${novoStatus}`,
        criadoPor: user.name,
      },
    }),
  ]);

  revalidatePath("/dashboard/atacado-prospeccao");
  redirect("/dashboard/atacado-prospeccao");
}
