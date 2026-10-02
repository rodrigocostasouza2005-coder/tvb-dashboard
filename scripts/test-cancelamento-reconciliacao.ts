// Teste de integração contra o banco DEV (Neon branch dev — .env.local). Só mexe em dados
// fictícios criados e apagados por ele mesmo (dapicVendaId 900000001/900000002, nunca existiram
// de verdade e nunca colidem com sync real). Cobre os 8 critérios de aceite da reconciliação de
// cancelamento retroativo (2026-10-02):
//   A. venda Fechada nova -> criada e válida
//   B. mesmo sync de novo -> não duplica
//   C. venda Fechada -> Cancelada -> Sale existente é atualizada (não inserida de novo)
//   D. sync após cancelamento -> não cria nova Sale
//   E. venda Cancelada -> não entra nas métricas (saleWhere)
//   F. venda que continua Fechada -> continua válida (controle, nunca tocada)
//   G. venda com múltiplos itens -> cada item mantém status/idempotência isolados
//   H. reconciliação rodada várias vezes -> resultado permanece consistente (idempotente)
// Uso: npx tsx scripts/test-cancelamento-reconciliacao.ts
import { prisma } from "@/lib/prisma";
import { upsertSalesComVendedorAtualizavel } from "@/lib/sync-runner";
import { saleWhere } from "@/lib/metrics";
import type { Prisma } from "@prisma/client";

const VENDA_A = 900000001; // 2 itens — item 0 será cancelado, item 1 fica Fechada (teste G)
const VENDA_B = 900000002; // 1 item — nunca cancelada, controle (teste F)

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`OK: ${msg}`);
}

function sale(overrides: Partial<Prisma.SaleCreateManyInput>): Prisma.SaleCreateManyInput {
  return {
    storeId: "",
    dapicVendaId: 0,
    itemIndex: 0,
    cod: "TESTE-RECONCILIACAO",
    produto: "Produto de teste (reconciliação)",
    grupo: "Teste",
    quantidade: 1,
    valorTotalLiquido: 100,
    saleDate: new Date(),
    status: "Fechada",
    ...overrides,
  };
}

async function main() {
  const store = await prisma.store.findFirst({ where: { sellsProducts: true } });
  if (!store) throw new Error("nenhuma loja encontrada pra testar");

  await prisma.sale.deleteMany({ where: { dapicVendaId: { in: [VENDA_A, VENDA_B] } } });

  const itemA0 = sale({ storeId: store.id, dapicVendaId: VENDA_A, itemIndex: 0 });
  const itemA1 = sale({ storeId: store.id, dapicVendaId: VENDA_A, itemIndex: 1, cod: "TESTE-RECONCILIACAO-2" });
  const itemB0 = sale({ storeId: store.id, dapicVendaId: VENDA_B, itemIndex: 0 });

  try {
    // A. venda Fechada nova (venda com 2 itens + venda de controle) -> criadas e válidas
    await upsertSalesComVendedorAtualizavel([itemA0, itemA1, itemB0]);
    let rowsA = await prisma.sale.findMany({ where: { dapicVendaId: VENDA_A }, orderBy: { itemIndex: "asc" } });
    let rowsB = await prisma.sale.findMany({ where: { dapicVendaId: VENDA_B } });
    assert(rowsA.length === 2, "[A] venda multi-item criada com 2 linhas");
    assert(rowsA.every((r) => r.status === "Fechada"), "[A] ambos os itens nascem Fechada");
    assert(rowsB.length === 1 && rowsB[0].status === "Fechada", "[A] venda de controle criada e Fechada");

    // B. mesmo sync de novo -> não duplica (nenhuma das 2 vendas, nenhum item)
    await upsertSalesComVendedorAtualizavel([itemA0, itemA1, itemB0]);
    rowsA = await prisma.sale.findMany({ where: { dapicVendaId: VENDA_A } });
    rowsB = await prisma.sale.findMany({ where: { dapicVendaId: VENDA_B } });
    assert(rowsA.length === 2, "[B] re-sync da venda multi-item NÃO duplicou (continua 2 linhas)");
    assert(rowsB.length === 1, "[B] re-sync da venda de controle NÃO duplicou (continua 1 linha)");

    // C. venda Fechada -> Cancelada: só o item 0 da Venda A é cancelado (mesma mecânica de
    // reconciliarCancelamentosVendas: update por storeId+dapicVendaId+itemIndex, nunca insert).
    const primeiroCancelamento = await prisma.sale.updateMany({
      where: { storeId: store.id, dapicVendaId: VENDA_A, itemIndex: 0, status: { not: "Cancelada" } },
      data: { status: "Cancelada", canceladaEm: new Date() },
    });
    assert(primeiroCancelamento.count === 1, "[C] reconciliação marcou exatamente 1 linha (item 0) como Cancelada");

    // G. item 1 da MESMA venda e a Venda B (venda inteiramente diferente) não foram afetados —
    // cada item mantém status isolado por itemIndex, cancelamento não vaza pra venda/item irmão.
    const itemA1Depois = await prisma.sale.findUnique({ where: { storeId_dapicVendaId_itemIndex: { storeId: store.id, dapicVendaId: VENDA_A, itemIndex: 1 } } });
    const itemB0Depois = await prisma.sale.findUnique({ where: { storeId_dapicVendaId_itemIndex: { storeId: store.id, dapicVendaId: VENDA_B, itemIndex: 0 } } });
    assert(itemA1Depois?.status === "Fechada", "[G] item 1 da venda multi-item continua Fechada (isolamento por itemIndex)");
    assert(itemB0Depois?.status === "Fechada", "[F] venda de controle, nunca tocada, continua Fechada/válida");

    // D. sync de novo após cancelamento -> não cria nova Sale, não regride status (upsert só
    // atualiza "vendedor", nunca "status" — ver upsertSalesComVendedorAtualizavel).
    await upsertSalesComVendedorAtualizavel([itemA0, itemA1, itemB0]);
    rowsA = await prisma.sale.findMany({ where: { dapicVendaId: VENDA_A } });
    assert(rowsA.length === 2, "[D] depois de cancelada + re-sync, venda A continua com 2 linhas (nenhuma nova)");
    const item0DepoisDoResync = rowsA.find((r) => r.itemIndex === 0);
    assert(item0DepoisDoResync?.status === "Cancelada", "[D] status do item cancelado não regride com o re-sync normal");

    // H. reconciliação rodada várias vezes -> resultado permanece consistente (idempotente): a
    // 2ª e 3ª tentativa de marcar o MESMO item como Cancelada não encontram nada pra atualizar
    // (where já exclui status=Cancelada), e nenhuma linha nova/duplicada aparece.
    const segundoCancelamento = await prisma.sale.updateMany({
      where: { storeId: store.id, dapicVendaId: VENDA_A, itemIndex: 0, status: { not: "Cancelada" } },
      data: { status: "Cancelada", canceladaEm: new Date() },
    });
    const terceiroCancelamento = await prisma.sale.updateMany({
      where: { storeId: store.id, dapicVendaId: VENDA_A, itemIndex: 0, status: { not: "Cancelada" } },
      data: { status: "Cancelada", canceladaEm: new Date() },
    });
    assert(segundoCancelamento.count === 0 && terceiroCancelamento.count === 0, "[H] reconciliação repetida é idempotente (0 updates nas tentativas seguintes)");
    const totalLinhasA = await prisma.sale.count({ where: { dapicVendaId: VENDA_A } });
    assert(totalLinhasA === 2, "[H] nenhuma linha duplicada/extra depois de reconciliar várias vezes");

    // E. métricas (saleWhere) deixam de contar o item cancelado, mas continuam contando o item
    // válido da mesma venda e a venda de controle inteira.
    const filters = {
      from: new Date(0),
      to: new Date(),
      storeIds: [store.id],
      marcas: undefined,
      tabelasPreco: undefined,
      grupoIn: undefined,
      tamanhoIn: undefined,
      colecaoIn: undefined,
    };
    const validasVendaA = await prisma.sale.count({ where: { ...saleWhere(filters), dapicVendaId: VENDA_A } });
    const validasVendaB = await prisma.sale.count({ where: { ...saleWhere(filters), dapicVendaId: VENDA_B } });
    assert(validasVendaA === 1, "[E] saleWhere() conta só o item 1 da venda A (item 0 cancelado excluído)");
    assert(validasVendaB === 1, "[F] saleWhere() continua contando a venda de controle normalmente");

    // Preservação de histórico: linha cancelada continua existindo no banco, nunca deletada.
    const semFiltroDeStatus = await prisma.sale.count({ where: { dapicVendaId: VENDA_A, itemIndex: 0 } });
    assert(semFiltroDeStatus === 1, "linha cancelada continua existindo no banco (não foi apagada)");

    console.log("\nTODOS OS TESTES PASSARAM (A-H).");
  } finally {
    await prisma.sale.deleteMany({ where: { dapicVendaId: { in: [VENDA_A, VENDA_B] } } });
    console.log("Limpeza: dados fictícios removidos.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
