#!/usr/bin/env node
/**
 * Consulta cadastral oficial Serpro/Receita Federal.
 * Seguro por padrão: sem --apply não chama a API e não grava dados.
 * Cada consulta pode ter custo conforme o contrato Serpro; limite máximo 25 por execução.
 */
import { PrismaClient } from "@prisma/client";
import { criarClienteSerpro, resumirSituacaoCnpj } from "../../src/lib/prospeccao/consulta-cnpj-serpro";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? fallback : fallback;
  };
  const apply = args.includes("--apply");
  const uf = arg("--uf", "RJ").toUpperCase();
  const limit = Number(arg("--limit", "5"));
  if (!/^[A-Z]{2}$/.test(uf)) throw new Error("--uf deve conter duas letras.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("--limit deve estar entre 1 e 25.");

  const prospects = await prisma.atacadoProspect.findMany({
    where: {
      estado: uf,
      cnpj: { not: null },
      status: { in: ["NOVO", "EM_QUALIFICACAO"] },
      grupoComercial: "PENDENTE",\n      origem: { in: ["pesquisa_web", "manual"] },
      NOT: { confiancaPesquisa: "CADASTRAL_OFICIAL" },
    },
    orderBy: [{ createdAt: "asc" }],
    take: limit,
    select: { id: true, cnpj: true, nomeFantasia: true, razaoSocial: true, observacoes: true, cidade: true, estado: true },
  });

  console.log("Consulta cadastral oficial Serpro | UF=" + uf + " | encontrados=" + prospects.length + " | limite=" + limit);
  for (const prospect of prospects) console.log(prospect.cnpj + " | " + prospect.nomeFantasia + " | " + (prospect.cidade ?? "cidade pendente"));
  if (!apply) {
    console.log("PRÉVIA: nenhuma chamada à API e nenhuma gravação. --apply dispara consultas oficiais que podem ser cobradas pelo Serpro.");
    return;
  }

  const consumerKey = process.env.SERPRO_CNPJ_CONSUMER_KEY;
  const consumerSecret = process.env.SERPRO_CNPJ_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) throw new Error("Configure SERPRO_CNPJ_CONSUMER_KEY e SERPRO_CNPJ_CONSUMER_SECRET antes de aplicar.");
  const client = criarClienteSerpro({
    consumerKey,
    consumerSecret,
    apiBaseUrl: process.env.SERPRO_CNPJ_API_BASE_URL,
    tokenUrl: process.env.SERPRO_CNPJ_TOKEN_URL,
  });

  let consultados = 0;
  let falhas = 0;
  for (const prospect of prospects) {
    try {
      const official = await client.consultarBasica(prospect.cnpj!);
      const previous = [
        "CONSULTA OFICIAL SERPRO/RECEITA FEDERAL",
        "Consulta em: " + new Date().toISOString(),
        "Situação: " + official.situacao + (official.situacaoCodigo ? " (código " + official.situacaoCodigo + ")" : ""),
        "Data da situação: " + (official.situacaoData ?? "não informada"),
        "Motivo: " + (official.motivo ?? "não informado"),
        "CNAE principal: " + [official.cnaePrincipalCodigo, official.cnaePrincipalDescricao].filter(Boolean).join(" - "),
        "CNAEs secundários: " + (official.cnaesSecundarios.join("; ") || "não informados"),
        "Endereço oficial: " + [official.endereco, official.cidade, official.estado, official.cep].filter(Boolean).join(" - "),
        "Porte: " + (official.porte ?? "não informado"),
        "Data de abertura: " + (official.dataAbertura ?? "não informada"),
      ].join("\n");

      const data = {
        ...(official.razaoSocial ? { razaoSocial: official.razaoSocial.slice(0, 180) } : {}),
        ...(official.nomeFantasia ? { nomeFantasia: official.nomeFantasia.slice(0, 160) } : {}),
        ...(official.cidade ? { cidade: official.cidade.slice(0, 100) } : {}),
        ...(official.codigoMunicipio ? { codigoMunicipio: official.codigoMunicipio.slice(0, 10) } : {}),
        ...(official.estado ? { estado: official.estado } : {}),
        ...(official.telefone ? { telefone: official.telefone.slice(0, 40) } : {}),
        ...(official.email ? { email: official.email.slice(0, 180) } : {}),
        confiancaPesquisa: "CADASTRAL_OFICIAL",
        pesquisadoEm: new Date(),
        observacoes: [prospect.observacoes ?? "", prospect.razaoSocial ? "Razão social anterior: " + prospect.razaoSocial : "", "Nome fantasia anterior: " + prospect.nomeFantasia, previous].filter(Boolean).join("\n\n").slice(0, 6000),
      };
      await prisma.$transaction([
        prisma.atacadoProspect.update({ where: { id: prospect.id }, data }),
        prisma.atacadoProspectActivity.create({
          data: {
            prospectId: prospect.id,
            tipo: "CONSULTA_CADASTRAL_OFICIAL",
            etapa: "VALIDACAO_RECEITA_FEDERAL",
            descricao: [
              resumirSituacaoCnpj(official.situacaoCodigo),
              "Razão social: " + (official.razaoSocial ?? "não informada"),
              "CNAE principal: " + (official.cnaePrincipalCodigo ?? "não informado"),
              "Endereço: " + [official.cidade, official.estado].filter(Boolean).join("/"),
              "Grupo comercial permaneceu PENDENTE; situação cadastral não equivale a aderência comercial.",
            ].join(" "),
            criadoPor: "INTEGRACAO_SERPRO_RECEITA",
          },
        }),
      ]);
      consultados++;
      console.log("OK " + prospect.cnpj + " | " + official.situacao + " | " + (official.cidade ?? "localização não informada"));
    } catch (error) {
      falhas++;
      console.error("FALHA " + prospect.cnpj + " | " + (error instanceof Error ? error.message : "erro desconhecido"));
    }
  }
  console.log("Concluído | consultados=" + consultados + " | falhas=" + falhas);
  if (falhas) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Falha na consulta oficial:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
