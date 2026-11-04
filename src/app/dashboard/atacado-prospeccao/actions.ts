"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { validarCnpj } from "@/lib/prospeccao/cnpj";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function normalizeCnpj(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeHttpUrl(input: string): string | null {
  if (!input) return null;
  try {
    const url = new URL(input);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isValidCnpjFormat(cnpj: string): boolean {
  // CNPJ alfanumérico: 12 posições alfanuméricas e 2 dígitos verificadores numéricos.
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj) || cnpj.length !== 14) return false;
  if (cnpj.split("").every((char) => char === cnpj[0])) return false;

  const calculate = (base: string, weights: number[]) => {
    const total = [...base].reduce(
      (sum, char, index) => sum + (char.charCodeAt(0) - 48) * weights[index],
      0,
    );
    const remainder = total % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };

  const first = calculate(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculate(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.slice(-2) === first + second;
}

export async function criarProspectAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  requireTabAccess(user, user.role, "atacado-prospeccao");

  const nomeFantasia = value(formData, "nomeFantasia");
  const cnpjRaw = value(formData, "cnpj");
  const cnpj = cnpjRaw ? normalizeCnpj(cnpjRaw) : null;
  const estado = value(formData, "estado").toUpperCase();
  const site = value(formData, "site");
  const instagram = value(formData, "instagram");
  const evidenciaRaw = value(formData, "evidenciaUrl");
  const evidenciaUrl = normalizeHttpUrl(evidenciaRaw);
  const siteUrl = normalizeHttpUrl(site);
  const instagramUrl = normalizeHttpUrl(instagram);
  if ((site && !siteUrl) || (instagram && !instagramUrl)) redirect("/dashboard/atacado-prospeccao?erro=url");
  if (evidenciaRaw && !evidenciaUrl) redirect("/dashboard/atacado-prospeccao?erro=url");

  if (!nomeFantasia) redirect("/dashboard/atacado-prospeccao?erro=nome");
  if (cnpj && !isValidCnpjFormat(cnpj)) redirect("/dashboard/atacado-prospeccao?erro=cnpj");
  if (estado && !/^[A-Z]{2}$/.test(estado)) redirect("/dashboard/atacado-prospeccao?erro=estado");

  try {
    const prospect = await prisma.atacadoProspect.create({
      data: {
        nomeFantasia,
        razaoSocial: value(formData, "razaoSocial") || null,
        cnpj,
        cidade: value(formData, "cidade") || null,
        estado: estado || null,
        site: siteUrl,
        instagram: instagramUrl,
        telefone: value(formData, "telefone") || null,
        email: value(formData, "email") || null,
        origem: value(formData, "origem") || "manual",
        evidenciaUrl,
        evidenciaEm: evidenciaUrl ? new Date() : null,
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
  "DESCARTADO",
]);

export async function atualizarStatusProspectAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  requireTabAccess(user, user.role, "atacado-prospeccao");

  const prospectId = value(formData, "prospectId");
  const novoStatus = value(formData, "status");
  if (novoStatus === "CONVERTIDO") redirect("/dashboard/atacado-prospeccao?erro=conversao");
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
    site: findIndex("site", "website", "siteoficial"),
    instagram: findIndex("instagram", "perfilinstagram", "instagramurl"),
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
    const cnpj = cnpjRaw ? normalizeCnpj(cnpjRaw) : null;
    const estado = get(columns.estado).toUpperCase().slice(0, 2);

    if (!nomeFantasia || (cnpj && !isValidCnpjFormat(cnpj)) || (estado && !/^[A-Z]{2}$/.test(estado))) {
      invalidos++;
      continue;
    }

    try {
      await prisma.atacadoProspect.create({
        data: {
          nomeFantasia,
          razaoSocial: get(columns.razao).slice(0, 180) || null,
          cnpj,
          cidade: get(columns.cidade).slice(0, 100) || null,
          estado: estado || null,
          telefone: get(columns.telefone).slice(0, 40) || null,
          email: get(columns.email).slice(0, 180) || null,
          site: normalizeHttpUrl(get(columns.site).slice(0, 500)),
          instagram: normalizeHttpUrl(get(columns.instagram).slice(0, 500)),
          evidenciaUrl: normalizeHttpUrl(get(columns.evidencia).slice(0, 1000)),
          evidenciaEm: normalizeHttpUrl(get(columns.evidencia)) ? new Date() : null,
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
  redirect(`/dashboard/atacado-prospeccao?importacao=concluida&novos=${importados}&duplicados=${duplicados}&invalidos=${invalidos}`);
}


const RESULTADOS_BRUCE = new Set([
  "INTERESSADO", "SEM_RESPOSTA", "RECUSOU", "PEDIU_CATALOGO", "PEDIU_PRECO",
  "NEGOCIANDO", "PEDIDO_REALIZADO", "RECOMPRA", "SEM_ADERENCIA", "DADOS_INVALIDOS", "OUTRO",
]);
const CANAIS_BRUCE = new Set(["TELEFONE", "EMAIL", "INSTAGRAM", "WHATSAPP", "PRESENCIAL", "OUTRO"]);

export async function registrarInteracaoBruceAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  requireTabAccess(user, user.role, "atacado-prospeccao");

  const prospectId = value(formData, "prospectId");
  const descricao = value(formData, "descricao");
  const resultado = value(formData, "resultado");
  const canal = value(formData, "canal");
  const etapa = value(formData, "etapa");
  const novoStatus = value(formData, "status");

  if (!prospectId || !descricao || descricao.length > 1200) {
    redirect("/dashboard/atacado-prospeccao?bruce=erro");
  }
  if (resultado && !RESULTADOS_BRUCE.has(resultado)) redirect("/dashboard/atacado-prospeccao?bruce=erro");
  if (canal && !CANAIS_BRUCE.has(canal)) redirect("/dashboard/atacado-prospeccao?bruce=erro");
  if (novoStatus === "CONVERTIDO") redirect("/dashboard/atacado-prospeccao?erro=conversao");
  if (novoStatus && !STATUS_VALIDOS.has(novoStatus)) redirect("/dashboard/atacado-prospeccao?bruce=erro");

  const atual = await prisma.atacadoProspect.findUnique({
    where: { id: prospectId },
    select: { id: true, status: true },
  });
  if (!atual) redirect("/dashboard/atacado-prospeccao?erro=nao-encontrado");

  await prisma.$transaction([
    prisma.atacadoProspectActivity.create({
      data: {
        prospectId,
        tipo: "INTERACAO_BRUCE",
        descricao,
        resultado: resultado || null,
        canal: canal || null,
        etapa: etapa.slice(0, 80) || null,
        criadoPor: user.name,
      },
    }),
    ...(novoStatus && novoStatus !== atual.status
      ? [prisma.atacadoProspect.update({ where: { id: prospectId }, data: { status: novoStatus } })]
      : []),
  ]);

  revalidatePath("/dashboard/atacado-prospeccao");
  redirect("/dashboard/atacado-prospeccao?bruce=registrado");
}


type CandidatoParaAprovacao = {
  nomeFantasia: string;
  cnpj: string;
  cidade: string;
  estado: string;
  site: string;
  trechoBusca: string;
  sinaisMasculino: string[];
  sinaisMultimarcas: string[];
  marcasEncontradas: string[];
  perfilReferencia: string;
};


export async function aprovarCandidatosDescobertosAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  requireTabAccess(user, user.role, "atacado-prospeccao");

  let candidatos: CandidatoParaAprovacao[];
  try {
    const raw = JSON.parse(value(formData, "candidatos"));
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) throw new Error("Quantidade inválida");
    candidatos = raw.map((item): CandidatoParaAprovacao => ({
      nomeFantasia: String(item.nomeFantasia ?? "").trim().slice(0, 160),
      cnpj: String(item.cnpj ?? "").trim(),
      cidade: String(item.cidade ?? "").trim().slice(0, 100),
      estado: String(item.estado ?? "").trim().toUpperCase(),
      site: String(item.site ?? "").trim(),
      trechoBusca: String(item.trechoBusca ?? "").trim().slice(0, 500),
      sinaisMasculino: Array.isArray(item.sinaisMasculino) ? item.sinaisMasculino.map(String).slice(0, 10) : [],
      sinaisMultimarcas: Array.isArray(item.sinaisMultimarcas) ? item.sinaisMultimarcas.map(String).slice(0, 10) : [],
      marcasEncontradas: Array.isArray(item.marcasEncontradas) ? item.marcasEncontradas.map(String).slice(0, 30) : [],
      perfilReferencia: String(item.perfilReferencia ?? "").trim().slice(0, 300),
    }));
  } catch {
    redirect("/dashboard/atacado-prospeccao?revisao=arquivo-invalido");
  }

  for (const candidato of candidatos) {
    if (!candidato.nomeFantasia || !validarCnpj(candidato.cnpj) || !/^[A-Z]{2}$/.test(candidato.estado) || !candidato.cidade) {
      redirect("/dashboard/atacado-prospeccao?revisao=dados-invalidos");
    }
    const site = normalizeHttpUrl(candidato.site);
    if (!site || !candidato.sinaisMasculino.length || (!candidato.sinaisMultimarcas.length && candidato.marcasEncontradas.length < 2)) {
      redirect("/dashboard/atacado-prospeccao?revisao=evidencia-invalida");
    }
  }

  let criados = 0;
  let duplicados = 0;
  for (const candidato of candidatos) {
    const cnpj = validarCnpj(candidato.cnpj)!;
    const site = normalizeHttpUrl(candidato.site)!;
    const existente = await prisma.atacadoProspect.findFirst({
      where: { OR: [{ cnpj }, { site }] },
      select: { id: true },
    });
    if (existente) { duplicados++; continue; }

    await prisma.atacadoProspect.create({
      data: {
        nomeFantasia: candidato.nomeFantasia,
        cnpj,
        cidade: candidato.cidade,
        estado: candidato.estado,
        site,
        evidenciaUrl: site,
        evidenciaEm: new Date(),
        origem: "pesquisa_web",
        origemAgente: "RADAR_DESCOBERTA_WEB_V1",
        grupoComercial: "PENDENTE",
        status: "NOVO",
        nomeComercialVerificado: false,
        observacoes: [
          "Candidato descoberto na web; aprovado manualmente para entrar na fila de qualificação, não para contato comercial.",
          `Evidência masculina: ${candidato.sinaisMasculino.join(", ")}.`,
          `Evidência multimarcas: ${candidato.sinaisMultimarcas.join(", ") || "não identificada; marcas encontradas: " + candidato.marcasEncontradas.join(", ")}.`,
          `Trecho de busca: ${candidato.trechoBusca}`,
          `Perfil que originou a busca: ${candidato.perfilReferencia}`,
        ].join("\n"),
        criadoPor: user.name,
        activities: {
          create: {
            tipo: "REVISAO_WEB_APROVADA",
            descricao: "Candidato da descoberta web revisado por pessoa e incluído na fila de qualificação. CNPJ informado e dígitos verificadores validados.",
            criadoPor: user.name,
          },
        },
      },
    });
    criados++;
  }

  revalidatePath("/dashboard/atacado-prospeccao");
  redirect(`/dashboard/atacado-prospeccao?revisao=concluida&novos=${criados}&duplicados=${duplicados}`);
}
