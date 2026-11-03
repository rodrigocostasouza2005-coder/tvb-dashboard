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


function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function importarProspectosCsvAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  requireTabAccess(user, user.role, "atacado-prospeccao");

  const file = formData.get("arquivo");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/dashboard/atacado-prospeccao?importacao=arquivo");
  }
  if (file.size > 900 * 1024) {
    redirect("/dashboard/atacado-prospeccao?importacao=tamanho");
  }

  const raw = (await file.text()).replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) redirect("/dashboard/atacado-prospeccao?importacao=vazio");

  const delimiter = (lines[0].match(/;/g) ?? []).length > (lines[0].match(/,/g) ?? []).length ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  const findIndex = (...names: string[]) => headers.findIndex((h) => names.includes(h));
  const columns = {
    nome: findIndex("nomefantasia", "nomeloja", "loja", "empresa", "nome"),
    razao: findIndex("razaosocial"),
    cnpj: findIndex("cnpj"),
    cidade: findIndex("cidade", "municipio"),
    estado: findIndex("uf", "estado"),
    telefone: findIndex("telefone", "telefonecomercial", "celular", "fone"),
    email: findIndex("email", "emailcomercial"),
    site: findIndex("site", "instagram", "website"),
    evidencia: findIndex("evidenciaurl", "origemurl", "url", "fonte"),
  };
  if (columns.nome < 0) redirect("/dashboard/atacado-prospeccao?importacao=cabecalho");
  if (lines.length - 1 > 500) redirect("/dashboard/atacado-prospeccao?importacao=limite");

  let importados = 0;
  let duplicados = 0;
  let invalidos = 0;

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line, delimiter);
    const get = (index: number) => index >= 0 ? (cells[index] ?? "").trim() : "";
    const nomeFantasia = get(columns.nome).slice(0, 160);
    const cnpjRaw = get(columns.cnpj);
    const cnpj = cnpjRaw ? cnpjRaw.replace(/\D/g, "") : null;
    const estado = get(columns.estado).toUpperCase().slice(0, 2);

    if (!nomeFantasia || (cnpj && cnpj.length !== 14) || (estado && !/^[A-Z]{2}$/.test(estado))) {
      invalidos++;
      continue;
    }

    try {
      const prospect = await prisma.atacadoProspect.create({
        data: {
          nomeFantasia,
          razaoSocial: get(columns.razao).slice(0, 180) || null,
          cnpj,
          cidade: get(columns.cidade).slice(0, 100) || null,
          estado: estado || null,
          telefone: get(columns.telefone).slice(0, 40) || null,
          email: get(columns.email).slice(0, 180) || null,
          site: get(columns.site).slice(0, 500) || null,
          evidenciaUrl: get(columns.evidencia).slice(0, 1000) || null,
          origem: "importacao",
          criadoPor: user.name,
          activities: {
            create: {
              tipo: "IMPORTACAO",
              descricao: "Prospecto importado por arquivo CSV",
              criadoPor: user.name,
            },
          },
        },
        select: { id: true },
      });
      importados++;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        duplicados++;
      } else {
        throw error;
      }
    }
  }

  revalidatePath("/dashboard/atacado-prospeccao");
  redirect(\`/dashboard/atacado-prospeccao?importacao=concluida&novos=\${importados}&duplicados=\${duplicados}&invalidos=\${invalidos}\`);
}
