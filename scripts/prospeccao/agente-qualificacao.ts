#!/usr/bin/env node
/**
 * Agente cadastral TVB v1.
 *
 * Consome apenas prospectos originados do dump público da Receita Federal.
 * Confirma consistência cadastral e qualidade mínima dos dados, atribui a fila
 * ao agente interno correto e registra evidência no Radar.
 *
 * Não declara que a loja é multimarcas ou de moda masculina: isso exige pesquisa
 * comercial adicional. Por isso grupoComercial permanece PENDENTE.
 * Seguro por padrão: só grava com --apply.
 */
import { PrismaClient } from "@prisma/client";
import { avaliarProspectoCadastral } from "../../src/lib/prospeccao/avaliacao-cadastral";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? fallback : fallback;
  };
  const apply = args.includes("--apply");
  const limit = Math.max(1, Math.min(500, Number(arg("--limit", "250")) || 250));
  const uf = arg("--uf", "RJ").toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) throw new Error("--uf deve conter duas letras.");

  const prospects = await prisma.atacadoProspect.findMany({
    where: {
      origem: "receita_federal_dados_abertos",
      estado: uf,
      status: "NOVO",
      grupoComercial: "PENDENTE",
      origemAgente: null,
      observacoes: { contains: "CNAE principal: 4781400" },
    },
    orderBy: [{ createdAt: "asc" }],
    take: limit,
    select: {
      id: true, nomeFantasia: true, cnpj: true, cidade: true, estado: true,
      telefone: true, email: true, site: true, evidenciaUrl: true, observacoes: true,
    },
  });

  const avaliados = prospects.map((prospect) => ({
    prospect,
    avaliacao: avaliarProspectoCadastral(prospect),
  }));
  const aptos = avaliados.filter(({ avaliacao }) => avaliacao.aptoParaFila);
  const pendentes = avaliados.length - aptos.length;

  console.log(`Agente cadastral | UF=${uf} | analisados=${avaliados.length} | aptos à fila=${aptos.length} | pendências=${pendentes}`);
  for (const { prospect, avaliacao } of avaliados.slice(0, 10)) {
    console.log(`${prospect.id} | score=${avaliacao.score} | ${avaliacao.agente} | ${avaliacao.motivo}`);
  }
  if (!apply) {
    console.log("PRÉVIA: nenhum registro alterado. Use --apply para atribuir a fila no Radar.");
    return;
  }
  if (aptos.length === 0) return;

  const now = new Date();
  const operations = aptos.map(({ prospect, avaliacao }) =>
    prisma.atacadoProspect.update({
      where: { id: prospect.id },
      data: {
        status: "EM_QUALIFICACAO",
        responsavel: avaliacao.agente,
        scoreComercial: avaliacao.score,
        justificativaGrupo: avaliacao.motivo,
        confiancaPesquisa: "CADASTRAL",
        nomeComercialVerificado: false,
        segmentoComercial: "VESTUARIO_E_ACESSORIOS_A_VALIDAR",
        origemAgente: "AGENTE_QUALIFICACAO_RECEITA_V1",
        pesquisadoEm: now,
      },
    }),
  );
  const activities = prisma.atacadoProspectActivity.createMany({
    data: aptos.map(({ prospect, avaliacao }) => ({
      prospectId: prospect.id,
      tipo: "AGENTE_QUALIFICACAO",
      descricao: `Triagem cadastral automática. ${avaliacao.motivo} Grupo comercial mantido PENDENTE até validação de perfil multimarcas/moda masculina.`,
      etapa: "TRIAGEM_CADASTRAL",
      criadoPor: "AGENTE_QUALIFICACAO_RECEITA_V1",
    })),
  });
  await prisma.$transaction([...operations, activities]);
  console.log(`Concluído: ${aptos.length} lojas atribuídas às filas de pesquisa/validação. Grupo A/B/C/D não foi inferido por CNAE.`);
}

main().catch((error) => {
  console.error("Falha no agente cadastral:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
