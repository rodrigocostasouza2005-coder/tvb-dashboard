// Sincronização real com a API do DAPIC (login + armazenadores + estoque + vendas).
// Uso: npx tsx scripts/sync-dapic.ts [diasDeVendas]
// diasDeVendas (opcional, padrão 3): quantos dias pra trás buscar em Pedidos de Vendas.

import { PrismaClient, type Prisma } from "@prisma/client";
import {
  fetchArmazenadores,
  fetchEstoqueTodosArmazenadores,
  fetchPedidosVendas,
  fetchPedidoVendaDetalhe,
} from "../src/lib/connectors/dapic";

const prisma = new PrismaClient();

const diasDeVendas = Number(process.argv[2] ?? 3);

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Armazenadores que sabemos que são canal de venda de verdade — o resto (Defeito, Lixeira,
// Bonificação, Marketing/Produção) ainda entra como Store (pra aparecer no filtro de estoque),
// só não conta como "loja que vende" nos relatórios de venda.
const CANAIS_DE_VENDA = new Set(["CD", "ATACADO"]);

async function syncArmazenadores() {
  const armazenadores = await fetchArmazenadores();
  const storeByDapicId = new Map<number, string>();

  for (const a of armazenadores) {
    const existing = await prisma.store.findFirst({
      where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] },
    });

    if (existing) {
      const updated = await prisma.store.update({
        where: { id: existing.id },
        data: { dapicArmazenadorId: a.Id },
      });
      storeByDapicId.set(a.Id, updated.id);
    } else {
      const created = await prisma.store.create({
        data: {
          code: a.Descricao,
          name: a.Descricao,
          dapicArmazenadorId: a.Id,
          sellsProducts: CANAIS_DE_VENDA.has(a.Descricao),
        },
      });
      storeByDapicId.set(a.Id, created.id);
    }
  }

  console.log(`Armazenadores sincronizados: ${armazenadores.length}`);
  return storeByDapicId;
}

async function syncEstoque(storeByDapicId: Map<number, string>) {
  const linhas = await fetchEstoqueTodosArmazenadores();
  console.log(`Linhas de estoque recebidas: ${linhas.length}`);

  const data: Prisma.StockSnapshotCreateManyInput[] = [];
  let semArmazenador = 0;

  for (const l of linhas) {
    const storeId = storeByDapicId.get(l.IdArmazenador);
    if (!storeId) {
      semArmazenador++;
      continue;
    }
    data.push({
      storeId,
      cod: String(l.IdGradeProduto),
      produto: l.Produto,
      grupo: l.Grupo ?? "(sem grupo)",
      cor: l.Cor ?? null,
      tamanho: l.Tamanho ?? null,
      colecao: l.Colecao ?? null,
      quantidadeDisponivel: l.QuantidadeReal ?? l.Quantidade ?? 0,
      valorCusto: l.ValorCusto ?? null,
    });
  }

  const BATCH = 2000;
  for (let i = 0; i < data.length; i += BATCH) {
    await prisma.stockSnapshot.createMany({ data: data.slice(i, i + BATCH) });
  }

  console.log(`Estoque gravado: ${data.length} (${semArmazenador} sem armazenador reconhecido)`);
  return data.length;
}

async function syncVendas(storeByDapicId: Map<number, string>) {
  // Vendas ainda não têm "armazenador" claro no resumo da API — por enquanto assume que
  // tudo cai no primeiro canal de venda conhecido (CD/Site e Atacado), até confirmarmos
  // como associar pedido -> loja na resposta real.
  const cdStore = await prisma.store.findFirst({ where: { code: "CD" } });
  if (!cdStore) {
    console.log("Store CD não encontrada — pulando sync de vendas.");
    return 0;
  }

  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - diasDeVendas);

  const resumos = await fetchPedidosVendas(toDateStr(inicio), toDateStr(hoje));
  console.log(`Pedidos de venda no período (${diasDeVendas} dias): ${resumos.length}`);

  const data: Prisma.SaleCreateManyInput[] = [];
  for (const resumo of resumos) {
    const detalhe = await fetchPedidoVendaDetalhe(resumo.Id);
    for (const item of detalhe.Produtos) {
      data.push({
        storeId: cdStore.id,
        cod: detalhe.Codigo,
        produto: item.Produto,
        grupo: "(a confirmar)",
        cor: item.Cor ?? null,
        tamanho: item.Tamanho ?? null,
        marca: null,
        clienteNome: detalhe.Cliente?.Nome ?? null,
        tabelaPreco: detalhe.TabelaPrecos ?? null,
        quantidade: item.Quantidade,
        valorTotalLiquido: item.ValorTotal,
        valorFrete: detalhe.Valores?.ValorFrete ?? null,
        saleDate: new Date(detalhe.DataEmissao),
      });
    }
  }

  if (data.length) {
    await prisma.sale.createMany({ data });
  }
  console.log(`Vendas gravadas: ${data.length}`);
  return data.length;
}

async function main() {
  console.log("Login + sync com a API real do DAPIC...");

  const storeByDapicId = await syncArmazenadores();
  await prisma.syncLog.create({
    data: { source: "STOCK", status: "SUCCESS", recordsSynced: storeByDapicId.size, message: "Sync de armazenadores (API real)", finishedAt: new Date() },
  });

  const estoqueCount = await syncEstoque(storeByDapicId);
  await prisma.syncLog.create({
    data: { source: "STOCK", status: "SUCCESS", recordsSynced: estoqueCount, message: "Sync de estoque (API real)", finishedAt: new Date() },
  });

  const vendasCount = await syncVendas(storeByDapicId);
  await prisma.syncLog.create({
    data: { source: "SALES", status: "SUCCESS", recordsSynced: vendasCount, message: "Sync de vendas (API real)", finishedAt: new Date() },
  });

  console.log("Sync concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
