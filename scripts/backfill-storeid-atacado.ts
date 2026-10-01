// Correção pontual, rodada uma vez: move o storeId de vendas já gravadas na loja CD (Site) mas
// com tabelaPreco="Tabela atacado" pra loja ATACADO. Achado em 2026-10-01 (mesma investigação da
// duplicata NITHI/PROS, ver dedupe-nithi-pros.ts): backfills anteriores (backfill-tabela-preco-
// b2b-null.ts e o backfill ad-hoc do commit 87ead95) corrigiram só o campo tabelaPreco de vendas
// já existentes via UPDATE — nunca moveram o storeId junto, já que esse campo só é decidido no
// momento do INSERT (sync-runner.ts). Resultado: 973 vendas (R$252.712,46) com classificação de
// canal correta (atacado) mas aparecendo na loja errada em qualquer filtro por Loja — não
// duplicava receita (canalWhere filtra por tabelaPreco, não por storeId), só a atribuição de loja
// ficava errada.
//
// Antes de mover, exclui qualquer (dapicVendaId, itemIndex) que já tenha uma linha na loja
// ATACADO também — esses já são as 96 duplicatas tratadas separadamente em dedupe-nithi-pros.ts
// (rodar esse script DEPOIS do dedupe, não antes, senão colide com o UNIQUE(storeId,
// dapicVendaId, itemIndex) ao tentar mover pra uma loja que já tem a mesma chave).
import { prisma } from "@/lib/prisma";

const CD = "cmsi0h80a0001uza8axxzbjhv";
const ATACADO = "cmsjjcwqq0000uz40onbfo2vd";

async function main() {
  const candidatos = await prisma.sale.findMany({
    where: { storeId: CD, tabelaPreco: "Tabela atacado" },
    select: { id: true, dapicVendaId: true, itemIndex: true },
  });
  console.log(`Candidatos (storeId=CD, tabelaPreco=Tabela atacado): ${candidatos.length}`);

  const jaExisteEmAtacado = await prisma.sale.findMany({
    where: { storeId: ATACADO, dapicVendaId: { in: [...new Set(candidatos.map((c) => c.dapicVendaId))] } },
    select: { dapicVendaId: true, itemIndex: true },
  });
  const chavesOcupadas = new Set(jaExisteEmAtacado.map((r) => `${r.dapicVendaId}::${r.itemIndex}`));

  const seguros = candidatos.filter((c) => !chavesOcupadas.has(`${c.dapicVendaId}::${c.itemIndex}`));
  const bloqueados = candidatos.length - seguros.length;
  console.log(`Seguros pra mover (sem colisão com linha já existente em ATACADO): ${seguros.length}`);
  if (bloqueados > 0) {
    console.log(`BLOQUEADOS (já existe linha com mesma chave em ATACADO, investigar à parte): ${bloqueados}`);
  }

  const result = await prisma.sale.updateMany({
    where: { id: { in: seguros.map((s) => s.id) } },
    data: { storeId: ATACADO },
  });
  console.log(`Movidas pra ATACADO: ${result.count}`);

  const restamNoCD = await prisma.sale.count({ where: { storeId: CD, tabelaPreco: "Tabela atacado" } });
  console.log(`Restam em CD com tabelaPreco=Tabela atacado: ${restamNoCD} (deve ser igual a 'bloqueados' acima)`);
}

main().finally(() => prisma.$disconnect());
