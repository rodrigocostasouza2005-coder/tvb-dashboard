#!/usr/bin/env node
/**
 * Diagnóstico somente-leitura da base de prospecção B2B — nunca escreve nada.
 * Rodado via GitHub Actions (DATABASE_URL de produção injetado como secret, mesmo padrão de
 * reconcile-production-prisma.yml) pra levantar números reais antes de decidir qualquer limpeza.
 *
 * Log só com agregados e, no máximo, nome fantasia (dado comercial público) — nunca CNPJ, email,
 * telefone ou endereço completo no log compartilhado do workflow.
 */
import { PrismaClient } from "@prisma/client";
import { detectarPossivelDuplicata, type CandidatoDedup } from "../../src/lib/prospeccao/motor-qualificacao";
import { derivarUrlsCandidatasPorEmail } from "../../src/lib/prospeccao/pesquisa-web";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.atacadoProspect.count();
  console.log(`Total de prospectos: ${total}`);

  const porStatus = await prisma.atacadoProspect.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("\nPor status (pipeline manual):");
  for (const row of porStatus.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.status}: ${row._count._all}`);
  }

  const porStatusComercial = await prisma.atacadoProspect.groupBy({ by: ["statusComercial"], _count: { _all: true } });
  console.log("\nPor statusComercial (motor de qualificação):");
  for (const row of porStatusComercial.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.statusComercial}: ${row._count._all}`);
  }

  const porClassificacao = await prisma.atacadoProspect.groupBy({ by: ["classificacaoProspect"], _count: { _all: true } });
  console.log("\nPor classificacaoProspect:");
  for (const row of porClassificacao) {
    console.log(`  ${row.classificacaoProspect ?? "(null)"}: ${row._count._all}`);
  }

  const comPesquisa = await prisma.atacadoProspect.count({ where: { pesquisadoEm: { not: null } } });
  const comEvidenciaMarca = await prisma.atacadoProspect.count({ where: { brands: { some: {} } } });
  console.log(`\nJá passaram por pesquisa comercial (pesquisadoEm preenchido): ${comPesquisa}`);
  console.log(`Já têm pelo menos 1 marca de terceiro evidenciada: ${comEvidenciaMarca}`);

  const descartados = await prisma.atacadoProspect.count({ where: { status: "DESCARTADO" } });
  const reprovadosMotor = await prisma.atacadoProspect.count({ where: { statusComercial: "REPROVADO" } });
  console.log(`\nstatus=DESCARTADO (pipeline manual): ${descartados}`);
  console.log(`statusComercial=REPROVADO (motor automático): ${reprovadosMotor}`);

  const semCnpj = await prisma.atacadoProspect.count({ where: { cnpj: null } });
  console.log(`\nSem CNPJ cadastrado: ${semCnpj}`);

  // Duplicidade — compara todos contra todos usando a função pura já existente (sem inventar
  // regra nova). O(n²) é seguro pro tamanho real da base (centenas, não milhões).
  const todos = await prisma.atacadoProspect.findMany({
    select: { id: true, cnpj: true, cnpjRaiz: true, nomeFantasia: true, cidade: true, estado: true, enderecoOficial: true },
  });
  const candidatos: CandidatoDedup[] = todos;
  const duplicatasPorTipo = new Map<string, number>();
  const paresReportados = new Set<string>();
  let totalPares = 0;
  for (const c of candidatos) {
    const sinais = detectarPossivelDuplicata(c, candidatos);
    for (const sinal of sinais) {
      duplicatasPorTipo.set(sinal.tipo, (duplicatasPorTipo.get(sinal.tipo) ?? 0) + 1);
    }
    if (sinais.length > 0) totalPares++;
  }
  console.log(`\nProspectos com pelo menos 1 sinal de possível duplicata: ${totalPares}`);
  for (const [tipo, count] of duplicatasPorTipo) {
    console.log(`  ${tipo}: ${count} ocorrências`);
  }

  // Diagnóstico temporário (branch diagnostico-pesquisa-comercial-temp, não mergeado em main):
  // investigar por que agente-pesquisa-comercial.ts retornou lojas=0 pra UF=RJ mesmo com
  // candidatos em EM_QUALIFICACAO — somente leitura, não altera nada.
  const porResponsavel = await prisma.atacadoProspect.groupBy({ by: ["responsavel"], _count: { _all: true } });
  console.log("\nPor responsavel:");
  for (const row of porResponsavel.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.responsavel ?? "(null)"}: ${row._count._all}`);
  }

  const porOrigem = await prisma.atacadoProspect.groupBy({ by: ["origem"], _count: { _all: true } });
  console.log("\nPor origem:");
  for (const row of porOrigem.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.origem}: ${row._count._all}`);
  }

  const porGrupoComercial = await prisma.atacadoProspect.groupBy({ by: ["grupoComercial"], _count: { _all: true } });
  console.log("\nPor grupoComercial:");
  for (const row of porGrupoComercial.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.grupoComercial}: ${row._count._all}`);
  }

  const porConfiancaPesquisa = await prisma.atacadoProspect.groupBy({ by: ["confiancaPesquisa"], _count: { _all: true } });
  console.log("\nPor confiancaPesquisa:");
  for (const row of porConfiancaPesquisa.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.confiancaPesquisa ?? "(null)"}: ${row._count._all}`);
  }

  const porEstado = await prisma.atacadoProspect.groupBy({ by: ["estado"], _count: { _all: true } });
  console.log("\nPor estado:");
  for (const row of porEstado.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.estado ?? "(null)"}: ${row._count._all}`);
  }

  // Quantos pendentes (EM_QUALIFICACAO, grupoComercial PENDENTE) têm e-mail com domínio próprio
  // (não genérico) — único caminho real de pesquisa comercial que não depende do DuckDuckGo
  // (ver pesquisa-web.ts, Melhoria 2: DuckDuckGo bloqueado por anti-bot em infra de nuvem). Só
  // conta e-mails (nunca imprime o valor) — compatível com a política de log deste script.
  const pendentesComEmail = await prisma.atacadoProspect.findMany({
    where: { status: "EM_QUALIFICACAO", grupoComercial: "PENDENTE" },
    select: { email: true },
  });
  const comDominioProprio = pendentesComEmail.filter((p) => derivarUrlsCandidatasPorEmail(p.email).length > 0).length;
  console.log(`\nPendentes com e-mail de domínio próprio (fallback sem depender de busca): ${comDominioProprio} de ${pendentesComEmail.length}`);

  const pendentesComSite = await prisma.atacadoProspect.count({
    where: { status: "EM_QUALIFICACAO", grupoComercial: "PENDENTE", site: { not: null } },
  });
  console.log(`Pendentes com site já cadastrado (fetch direto, também não depende de busca): ${pendentesComSite} de ${pendentesComEmail.length}`);

  console.log("\n(Diagnóstico concluído — nenhum registro foi alterado.)");
}

main()
  .catch((error) => {
    console.error("Falha no diagnóstico:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
