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
 *
 * NÃO chama o motor de qualificação completo (motor-qualificacao.ts) — decisão deliberada,
 * documentada em src/lib/prospeccao/adaptadores-qualificacao.ts: o critério MULTIMARCAS do gate
 * não tem estado intermediário (zero marca comprovada já é reprovação definitiva), e nesta etapa
 * nenhum candidato ainda tem evidência de marca. Rodar o gate completo aqui reprovaria 100% dos
 * candidatos antes mesmo da pesquisa comercial acontecer. O motor completo só é chamado em
 * agente-pesquisa-comercial.ts, a única etapa com chance real de evidência de marca. Esta etapa
 * (triagem cadastral) continua decidindo "apto para fila" com avaliarProspectoCadastral, como
 * antes; o que muda no rebuild é que ela agora também grava os dois campos puramente derivados
 * do schema novo (cnpjRaiz, capitalEstadual) que a cota geográfica futura (quota-geografica.ts)
 * vai precisar — ver docs/PROSPECCAO_EXTERNA.md, checklist de preparação da descoberta nacional.
 */
import { PrismaClient } from "@prisma/client";
import { avaliarProspectoCadastral } from "../../src/lib/prospeccao/avaliacao-cadastral";
import { calcularCnpjRaiz } from "../../src/lib/prospeccao/adaptadores-qualificacao";
import { ehCapitalEstadual } from "../../src/lib/prospeccao/capitais-estaduais";

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
      origemAgente: "AGENTE_CAPTACAO_RECEITA_V1",
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
        // Plumbing do rebuild do motor (Fase 1, PR #51): puramente derivados de CNPJ/UF/
        // município, sem depender de nenhuma evidência comercial ainda — ver
        // adaptadores-qualificacao.ts. cnpjRaiz agrupa matriz/filial; capitalEstadual alimenta
        // aplicarQuotaGeografica() numa fase futura (descoberta nacional real, não executada aqui).
        cnpjRaiz: calcularCnpjRaiz(prospect.cnpj),
        capitalEstadual: ehCapitalEstadual(prospect.estado ?? "", prospect.cidade),
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
