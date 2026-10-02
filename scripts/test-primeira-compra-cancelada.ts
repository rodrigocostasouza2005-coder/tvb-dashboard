// Teste de integração contra o banco DEV (Neon branch dev — .env.local). Cobre os gaps da
// auditoria final de 2026-10-02: "primeira compra"/"produto porta de entrada" contaminados por
// venda cancelada em getPrimeiraCompraGlobalPorCliente, getProdutosPortaDeEntrada e
// getPrimeiraVendaData. Só mexe em dados fictícios criados e apagados por ele mesmo
// (dapicVendaId 900002001-900002005, clienteNome/produto com prefixo "ZZTESTE", nunca existiram
// de verdade e nunca colidem com sync real). DEV não recebe sync novo (cron só aponta pra
// produção), então os deltas antes/depois medidos aqui são seguros mesmo com dado histórico real
// coexistindo no banco.
//
// Casos cobertos (pedido do Rodrigo em 2026-10-02):
//   1. venda cancelada não pode ser a primeira compra
//   2. venda cancelada não pode definir produto porta de entrada
//   3. venda válida continua sendo considerada primeira compra
//   4. cliente com 1ª venda cancelada + 2ª válida é classificado usando a 2ª
//   5. cliente sem vendas válidas não é tratado como cliente com compra válida
//   6. nenhuma regressão nas métricas afetadas (getNovosERecorrentesClientes, getPrimeiraVendaData)
// Uso: npx tsx scripts/test-primeira-compra-cancelada.ts
import { prisma } from "@/lib/prisma";
import { getNovosERecorrentesClientes, getProdutosPortaDeEntrada, getPrimeiraVendaData } from "@/lib/metrics";
import type { Prisma } from "@prisma/client";

const CLIENTE_A_SO_CANCELADA = "ZZTESTE SO CANCELADA A"; // caso 2/5: nunca comprou de verdade
const CLIENTE_B_RECLASSIFICA = "ZZTESTE RECLASSIFICA B"; // caso 1/4: 1ª cancelada (antiga) + 2ª válida (hoje)
const CLIENTE_C_CONTROLE = "ZZTESTE CONTROLE C"; // caso 3/6: só venda válida, controle de regressão

const PRODUTO_A = "ZZPRODUTO-A-SOCANCELADA";
const PRODUTO_B_CANCELADA = "ZZPRODUTO-B-CANCELADA-ANTIGA";
const PRODUTO_B_VALIDA = "ZZPRODUTO-B-VALIDA-RECENTE";
const PRODUTO_C = "ZZPRODUTO-C-CONTROLE";

const DAPIC_IDS = [900002001, 900002002, 900002003, 900002004];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`OK: ${msg}`);
}

function sale(overrides: Partial<Prisma.SaleCreateManyInput>): Prisma.SaleCreateManyInput {
  return {
    storeId: "",
    dapicVendaId: 0,
    itemIndex: 0,
    cod: "ZZTESTE",
    produto: "ZZTESTE-PRODUTO",
    grupo: "ZZTeste",
    clienteNome: null,
    quantidade: 1,
    valorTotalLiquido: 100,
    saleDate: new Date(),
    status: "Fechada",
    ...overrides,
  };
}

async function limpar(store: { id: string }) {
  await prisma.sale.deleteMany({ where: { dapicVendaId: { in: DAPIC_IDS } } });
  await prisma.sale.deleteMany({
    where: { clienteNome: { in: [CLIENTE_A_SO_CANCELADA, CLIENTE_B_RECLASSIFICA, CLIENTE_C_CONTROLE] }, storeId: store.id },
  });
}

async function main() {
  const store = await prisma.store.findFirst({ where: { sellsProducts: true } });
  if (!store) throw new Error("nenhuma loja encontrada pra testar");

  await limpar(store);

  const agora = new Date();
  const dezMinAtras = new Date(agora.getTime() - 10 * 60_000);
  const dezMinDepois = new Date(agora.getTime() + 10 * 60_000);
  const trintaDiasAtras = new Date(agora.getTime() - 30 * 86_400_000);
  const anoAntigo = new Date("2000-01-01T00:00:00Z"); // bem antes de qualquer dado real do DAPIC

  const filtersJanelaEstreita = {
    from: dezMinAtras,
    to: dezMinDepois,
    storeIds: [store.id],
    marcas: undefined,
    tabelasPreco: undefined,
    grupoIn: undefined,
    tamanhoIn: undefined,
    colecaoIn: undefined,
  };

  try {
    // ===== Baseline (antes de inserir qualquer dado fictício) =====
    const baselineNovosRecorrentes = await getNovosERecorrentesClientes(filtersJanelaEstreita);
    const baselinePrimeiraVenda = await getPrimeiraVendaData();

    // ===== Inserção dos cenários =====
    await prisma.sale.createMany({
      data: [
        // Caso 2/5: cliente A só tem venda Cancelada, hoje (dentro da janela estreita)
        sale({
          storeId: store.id,
          dapicVendaId: DAPIC_IDS[0],
          clienteNome: CLIENTE_A_SO_CANCELADA,
          produto: PRODUTO_A,
          saleDate: agora,
          status: "Cancelada",
        }),
        // Caso 1/4: cliente B — 1ª venda (30 dias atrás, FORA da janela) Cancelada
        sale({
          storeId: store.id,
          dapicVendaId: DAPIC_IDS[1],
          clienteNome: CLIENTE_B_RECLASSIFICA,
          produto: PRODUTO_B_CANCELADA,
          saleDate: trintaDiasAtras,
          status: "Cancelada",
        }),
        // Caso 1/4: cliente B — 2ª venda (hoje, DENTRO da janela) válida
        sale({
          storeId: store.id,
          dapicVendaId: DAPIC_IDS[2],
          clienteNome: CLIENTE_B_RECLASSIFICA,
          produto: PRODUTO_B_VALIDA,
          saleDate: agora,
          status: "Fechada",
        }),
        // Caso 3/6: cliente C — controle, só venda válida, hoje
        sale({
          storeId: store.id,
          dapicVendaId: DAPIC_IDS[3],
          clienteNome: CLIENTE_C_CONTROLE,
          produto: PRODUTO_C,
          saleDate: agora,
          status: "Fechada",
        }),
      ],
    });

    // ===== getNovosERecorrentesClientes =====
    const depoisNovosRecorrentes = await getNovosERecorrentesClientes(filtersJanelaEstreita);
    const deltaNovos = depoisNovosRecorrentes.novos - baselineNovosRecorrentes.novos;
    const deltaRecorrentes = depoisNovosRecorrentes.recorrentes - baselineNovosRecorrentes.recorrentes;

    // Cliente A (só cancelada) nunca entra em clientesNoPeriodo (saleWhere já exclui Cancelada) —
    // não soma em novos nem recorrentes. [caso 5]
    // Cliente B: se a venda cancelada antiga (30 dias) vazasse como "1ª compra", cairia como
    // "recorrente" (first < from); com o fix, "1ª compra" = a venda válida de hoje -> "novo". [caso 1/4]
    // Cliente C: controle, só venda válida hoje -> "novo". [caso 3/6, regressão]
    // Total esperado: +2 novos (B e C), +0 recorrentes (nem A nem B contaminam recorrentes).
    assert(deltaNovos === 2, "[1,3,4,5] getNovosERecorrentesClientes: +2 novos (cliente B reclassificado + cliente C controle), cliente A (só cancelada) não contou");
    assert(deltaRecorrentes === 0, "[1,4] getNovosERecorrentesClientes: cliente B NÃO caiu como recorrente (venda cancelada antiga não vazou como 1ª compra)");

    // ===== getProdutosPortaDeEntrada =====
    const allTimeFilters = {
      from: anoAntigo,
      to: new Date(agora.getTime() + 60_000),
      storeIds: [store.id],
      marcas: undefined,
      tabelasPreco: undefined,
      grupoIn: undefined,
      tamanhoIn: undefined,
      colecaoIn: undefined,
    };
    const portaDeEntrada = await getProdutosPortaDeEntrada(allTimeFilters, "todos", 1_000_000);

    const temProdutoA = portaDeEntrada.primeiraCompra.some((p) => p.produto === PRODUTO_A);
    const temProdutoBCancelada = portaDeEntrada.primeiraCompra.some((p) => p.produto === PRODUTO_B_CANCELADA);
    const produtoBValida = portaDeEntrada.primeiraCompra.find((p) => p.produto === PRODUTO_B_VALIDA);
    const produtoC = portaDeEntrada.primeiraCompra.find((p) => p.produto === PRODUTO_C);
    const compradorUnicoBValida = portaDeEntrada.compradorUnico.find((p) => p.produto === PRODUTO_B_VALIDA);
    const compradorUnicoC = portaDeEntrada.compradorUnico.find((p) => p.produto === PRODUTO_C);

    assert(!temProdutoA, "[2,5] getProdutosPortaDeEntrada: produto da venda cancelada única (cliente A) NÃO aparece como porta de entrada");
    assert(!temProdutoBCancelada, "[1,2,4] getProdutosPortaDeEntrada: produto da 1ª venda cancelada (cliente B) NÃO aparece como porta de entrada");
    assert(!!produtoBValida && produtoBValida.clientes === 1, "[1,4] getProdutosPortaDeEntrada: produto da venda VÁLIDA do cliente B aparece como porta de entrada dele");
    assert(!!produtoC && produtoC.clientes === 1, "[3,6] getProdutosPortaDeEntrada: produto do cliente C (controle) continua aparecendo — sem regressão");
    // "Comprador único": cliente B tem 2 pedidos no banco, mas só 1 válido (pedidoCounts agora
    // também exclui Cancelada) — precisa contar como comprador único no pedido válido.
    assert(!!compradorUnicoBValida, "[1,4] getProdutosPortaDeEntrada: cliente B conta como comprador único (pedido cancelado não soma na contagem de pedidos)");
    assert(!!compradorUnicoC, "[3,6] getProdutosPortaDeEntrada: cliente C (controle) continua como comprador único — sem regressão");

    // ===== getPrimeiraVendaData =====
    // Insere uma venda MUITO antiga (ano 2000) e CANCELADA — não deve mudar o mínimo global.
    await prisma.sale.create({
      data: sale({
        storeId: store.id,
        dapicVendaId: 900002005,
        clienteNome: "ZZTESTE DATA MIN CANCELADA",
        produto: "ZZPRODUTO-DATA-MIN-CANCELADA",
        saleDate: anoAntigo,
        status: "Cancelada",
      }),
    });
    const primeiraVendaComCanceladaAntiga = await getPrimeiraVendaData();
    assert(
      primeiraVendaComCanceladaAntiga?.getTime() === baselinePrimeiraVenda?.getTime(),
      "[6] getPrimeiraVendaData: venda cancelada do ano 2000 NÃO virou a 'venda mais antiga' global"
    );

    // Agora insere uma venda MUITO antiga (1999) e VÁLIDA — essa SIM deve mudar o mínimo global,
    // confirmando que o filtro não quebrou o caso de uma venda válida antiga de verdade [regressão].
    const anoMaisAntigoAinda = new Date("1999-01-01T00:00:00Z");
    await prisma.sale.create({
      data: sale({
        storeId: store.id,
        dapicVendaId: 900002006,
        clienteNome: "ZZTESTE DATA MIN VALIDA",
        produto: "ZZPRODUTO-DATA-MIN-VALIDA",
        saleDate: anoMaisAntigoAinda,
        status: "Fechada",
      }),
    });
    const primeiraVendaComValidaAntiga = await getPrimeiraVendaData();
    assert(
      primeiraVendaComValidaAntiga?.getTime() === anoMaisAntigoAinda.getTime(),
      "[3,6] getPrimeiraVendaData: venda VÁLIDA de 1999 passou a ser a 'venda mais antiga' global — filtro não quebrou o caso válido"
    );

    await prisma.sale.deleteMany({ where: { dapicVendaId: { in: [900002005, 900002006] } } });

    console.log("\nTODOS OS TESTES PASSARAM (primeira compra / produto porta de entrada).");
  } finally {
    await limpar(store);
    console.log("Limpeza: dados fictícios removidos.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
