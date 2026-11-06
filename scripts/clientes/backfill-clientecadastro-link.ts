// Backfill único (missão "ligue venda com cadastro", 2026-11-06) — preenche Sale.clienteCadastroId
// pra todo histórico que a sync de agora em diante não alcança (ver src/lib/sync-runner.ts: a
// resolução por IdCliente/nome só roda pra venda NOVA sincronizada depois desta migration).
//
// Só pode usar NOME aqui (nunca ID) — Sale nunca guardou o IdCliente bruto da fatura (de propósito,
// ver cliente-cadastro-link.ts: resolve pra clienteCadastroId direto no sync, sem persistir o Id
// intermediário), então pra uma linha histórica já gravada sem esse vínculo não existe mais como
// recuperar a confiança "ID" sem reconsultar a API do DAPIC fatura por fatura (fora do escopo deste
// backfill — ver RESUMO DE COBERTURA no fim do arquivo). Mesma limitação de sempre, agora pelo
// menos FORMALIZADA com o flag de confiança (clienteCadastroMatchConfianca = "NOME"), em vez de
// ficar implícita.
//
// Idempotente: só toca Sale com clienteCadastroId ainda NULL. Rodar de novo depois de qualquer
// sync nova não desfaz nada — só preenche o que continuar faltando.
import { prisma } from "../../src/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  buildClienteCadastroIndex,
  resolverClienteCadastro,
  normalizarNomeCliente,
} from "../../src/lib/cliente-cadastro-link";

const BATCH = 1000;

async function main() {
  const totalSale = await prisma.sale.count();
  const jaResolvidoId = await prisma.sale.count({ where: { clienteCadastroMatchConfianca: "ID" } });
  const jaResolvidoNome = await prisma.sale.count({ where: { clienteCadastroMatchConfianca: "NOME" } });
  console.log(`Sale total: ${totalSale}`);
  console.log(`Já resolvido por ID (sync novo, antes deste backfill rodar): ${jaResolvidoId}`);
  console.log(`Já resolvido por NOME (sync novo, antes deste backfill rodar): ${jaResolvidoNome}`);

  const candidatos = await prisma.clienteCadastro.findMany({ select: { id: true, dapicId: true, nome: true } });
  console.log(`ClienteCadastro candidatos carregados: ${candidatos.length}`);
  const index = buildClienteCadastroIndex(candidatos);

  // Nomes distintos (raw, como gravado em Sale) ainda sem vínculo — resolve 1x por nome distinto,
  // não 1x por linha (um mesmo cliente aparece em muitas vendas).
  const semVinculo = await prisma.sale.findMany({
    where: { clienteCadastroId: null, clienteNome: { not: null } },
    distinct: ["clienteNome"],
    select: { clienteNome: true },
  });
  console.log(`Nomes distintos sem vínculo ainda: ${semVinculo.length}`);

  const semNomeNenhum = await prisma.sale.count({ where: { clienteCadastroId: null, clienteNome: null } });

  let resolvidosPorNomeAgora = 0;
  let semMatch = 0;
  let homonimoAmbiguo = 0;
  const atualizacoes: { nome: string; clienteCadastroId: string; confianca: "ID" | "NOME" }[] = [];

  for (const row of semVinculo) {
    const nome = row.clienteNome as string;
    const resolucao = resolverClienteCadastro({ clienteNome: nome }, index);
    if (resolucao) {
      atualizacoes.push({ nome, clienteCadastroId: resolucao.clienteCadastroId, confianca: resolucao.confianca });
      resolvidosPorNomeAgora++;
    } else {
      const norm = normalizarNomeCliente(nome);
      const candidatosHomonimos = index.porNomeNormalizado.get(norm);
      if (candidatosHomonimos && candidatosHomonimos.length > 1) homonimoAmbiguo++;
      else semMatch++;
    }
  }

  console.log(`Resolvidos agora por NOME: ${resolvidosPorNomeAgora}`);
  console.log(`Sem nenhum ClienteCadastro correspondente: ${semMatch}`);
  console.log(`Homônimo ambíguo (2+ ClienteCadastro com o mesmo nome normalizado — nunca escolhido a esmo): ${homonimoAmbiguo}`);
  console.log(`Sale sem clienteNome nenhum (nunca poderia resolver, nem antes nem agora): ${semNomeNenhum}`);

  let linhasAtualizadas = 0;
  for (let i = 0; i < atualizacoes.length; i += BATCH) {
    const lote = atualizacoes.slice(i, i + BATCH);
    const values = lote.map(
      (u) => Prisma.sql`(${u.nome}, ${u.clienteCadastroId}, ${u.confianca}::"ClienteCadastroMatchConfianca")`
    );
    const result = await prisma.$executeRaw`
      UPDATE "Sale" AS s
      SET "clienteCadastroId" = m.cid, "clienteCadastroMatchConfianca" = m.conf
      FROM (VALUES ${Prisma.join(values)}) AS m(nome, cid, conf)
      WHERE s."clienteNome" = m.nome AND s."clienteCadastroId" IS NULL
    `;
    linhasAtualizadas += result;
    console.log(`Lote ${i / BATCH + 1}: ${result} linhas de Sale atualizadas (${lote.length} nomes distintos no lote)`);
  }

  console.log(`\nTotal de linhas de Sale atualizadas por este backfill: ${linhasAtualizadas}`);

  // Cobertura final real, pós-backfill — sem inflar confiança.
  const [totalFinal, idFinal, nomeFinal, nullFinal] = await Promise.all([
    prisma.sale.count(),
    prisma.sale.count({ where: { clienteCadastroMatchConfianca: "ID" } }),
    prisma.sale.count({ where: { clienteCadastroMatchConfianca: "NOME" } }),
    prisma.sale.count({ where: { clienteCadastroId: null } }),
  ]);
  console.log("\n=== COBERTURA FINAL (pós-backfill) ===");
  console.log(`Total Sale: ${totalFinal}`);
  console.log(`Vinculado por ID (confiável): ${idFinal} (${((idFinal / totalFinal) * 100).toFixed(1)}%)`);
  console.log(`Vinculado por NOME (mesma limitação de sempre): ${nomeFinal} (${((nomeFinal / totalFinal) * 100).toFixed(1)}%)`);
  console.log(`Sem vínculo nenhum: ${nullFinal} (${((nullFinal / totalFinal) * 100).toFixed(1)}%)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// RESUMO DE COBERTURA (ler antes de consumir clienteCadastroId em qualquer UI/métrica nova):
// 1. ID (confiável, sem comparação de string) só existe pra venda sincronizada DEPOIS desta
//    migration via /faturas (Site + Atacado, token cd-atacado) — ver sync-runner.ts/syncFaturas.
//    /vendaspdv (loja física: Leblon/Rio Sul/Barra) NUNCA expõe identificador de cliente, então
//    essas lojas nunca chegam em confianca "ID" — nem em venda nova, nem neste backfill.
// 2. NOME (este backfill, mais a venda nova de /vendaspdv) é a MESMA limitação que já existia
//    antes de toda esta migration: homônimo real (2+ ClienteCadastro com nome normalizado igual)
//    nunca é resolvido (fica null de propósito, nunca escolhido a esmo) — ver homonimoAmbiguo acima.
// 3. Este script NUNCA reconsulta a API do DAPIC — só casa contra o ClienteCadastro já sincronizado
//    no momento em que roda. Se um ClienteCadastro novo entrar depois (próximo sync de /clientes),
//    rodar este script de novo pode resolver nomes que ainda estavam null.
