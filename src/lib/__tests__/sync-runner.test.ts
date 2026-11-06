import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { DapicClient } from "@/lib/connectors/dapic";

const storeFindFirst = vi.fn();
const storeFindMany = vi.fn();
const storeUpdate = vi.fn();
const storeCreate = vi.fn();
const syncLockFindMany = vi.fn();
const syncLockUpsert = vi.fn();
const syncLockUpdate = vi.fn().mockResolvedValue(undefined);
const syncLockFindUnique = vi.fn().mockResolvedValue(null);
const syncLogFindFirst = vi.fn().mockResolvedValue(null);
const priceCatalogCacheFindFirst = vi.fn().mockResolvedValue(null);
const parcelaDeleteMany = vi.fn();
const parcelaCreateMany = vi.fn();
const giftFindMany = vi.fn();
const saleFindMany = vi.fn();
const saleUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const returnFindMany = vi.fn().mockResolvedValue([]);
const returnUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
// Carregado 1x por syncVendas/syncFaturas pra resolver Sale.clienteCadastroId (ver
// cliente-cadastro-link.ts) — vazio por padrão aqui, os testes deste arquivo não cobrem esse
// vínculo especificamente (ver src/lib/__tests__/cliente-cadastro-link.test.ts pra lógica pura).
const clienteCadastroFindMany = vi.fn().mockResolvedValue([]);
const syncLogCreate = vi.fn().mockResolvedValue({});
const executeRaw = vi.fn().mockResolvedValue(undefined);
const sendTelegramMessageMock = vi.fn().mockResolvedValue(undefined);

// Simulação real da constraint @@unique([clientLabel, dapicArmazenadorId]) de ArmazemConhecido
// (não um vi.fn() solto) — um Map em memória, resetado a cada teste, que se comporta como o
// Postgres se comportaria: 1ª criação de uma chave sucede, a 2ª lança o mesmo erro de violação
// de unicidade (P2002) que verificarArmazemNovo() trata; findMany filtra por clientLabel (usado
// por carregarArmazensConhecidos, chamado 1x por syncArmazenadores desde 2026-11-01 — antes era
// 1-2 queries por armazém dentro do loop, achado real: instabilidade pontual do Neon fazia todos
// os armazéns de um token falharem juntos). Mais realista que mockar chamada por chamada, e
// deixa os testes só precisarem "pré-semear" quem já é conhecido.
let armazensConhecidosSimulados = new Map<string, { nomeAtual: string; classificacao: string }>();
const armazemConhecidoCreate = vi.fn();
armazemConhecidoCreate.mockImplementation(async ({ data }: { data: { clientLabel: string; dapicArmazenadorId: number; nomeAtual: string; classificacao: string } }) => {
  const chave = `${data.clientLabel}::${data.dapicArmazenadorId}`;
  if (armazensConhecidosSimulados.has(chave)) {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
  }
  armazensConhecidosSimulados.set(chave, { nomeAtual: data.nomeAtual, classificacao: data.classificacao });
  return {};
});
const armazemConhecidoFindMany = vi.fn();
armazemConhecidoFindMany.mockImplementation(async ({ where }: { where: { clientLabel: string } }) => {
  const prefixo = `${where.clientLabel}::`;
  return [...armazensConhecidosSimulados.entries()]
    .filter(([chave]) => chave.startsWith(prefixo))
    .map(([chave, v]) => ({ dapicArmazenadorId: Number(chave.slice(prefixo.length)), nomeAtual: v.nomeAtual, classificacao: v.classificacao }));
});
const armazemConhecidoUpdate = vi.fn();
armazemConhecidoUpdate.mockImplementation(
  async ({ where, data }: { where: { clientLabel_dapicArmazenadorId: { clientLabel: string; dapicArmazenadorId: number } }; data: { nomeAtual: string; classificacao: string } }) => {
    const { clientLabel, dapicArmazenadorId } = where.clientLabel_dapicArmazenadorId;
    armazensConhecidosSimulados.set(`${clientLabel}::${dapicArmazenadorId}`, data);
    return {};
  }
);

// $transaction aqui só executa o callback contra o mesmo objeto mockado de "prisma" (os métodos
// usados dentro de cada transação — syncLock.*, parcela.* — têm os mesmos nomes em tx e em
// prisma) — suficiente pra testar a LÓGICA de dentro da transação, não o isolamento real do
// Postgres (isso fica pra verificação manual contra o Neon de dev, como o plano já previa).
const mockPrisma = {
  store: {
    findFirst: (...a: unknown[]) => storeFindFirst(...a),
    findMany: (...a: unknown[]) => storeFindMany(...a),
    update: (...a: unknown[]) => storeUpdate(...a),
    create: (...a: unknown[]) => storeCreate(...a),
  },
  armazemConhecido: {
    create: (...a: unknown[]) => armazemConhecidoCreate(...a),
    findMany: (...a: unknown[]) => armazemConhecidoFindMany(...a),
    update: (...a: unknown[]) => armazemConhecidoUpdate(...a),
  },
  syncLock: {
    findMany: (...a: unknown[]) => syncLockFindMany(...a),
    upsert: (...a: unknown[]) => syncLockUpsert(...a),
    update: (...a: unknown[]) => syncLockUpdate(...a),
    findUnique: (...a: unknown[]) => syncLockFindUnique(...a),
  },
  parcela: {
    deleteMany: (...a: unknown[]) => parcelaDeleteMany(...a),
    createMany: (...a: unknown[]) => parcelaCreateMany(...a),
  },
  gift: {
    findMany: (...a: unknown[]) => giftFindMany(...a),
  },
  clienteCadastro: {
    findMany: (...a: unknown[]) => clienteCadastroFindMany(...a),
  },
  sale: {
    findMany: (...a: unknown[]) => saleFindMany(...a),
    updateMany: (...a: unknown[]) => saleUpdateMany(...a),
  },
  return: {
    findMany: (...a: unknown[]) => returnFindMany(...a),
    updateMany: (...a: unknown[]) => returnUpdateMany(...a),
  },
  syncLog: {
    create: (...a: unknown[]) => syncLogCreate(...a),
    findFirst: (...a: unknown[]) => syncLogFindFirst(...a),
  },
  priceCatalogCache: {
    findFirst: (...a: unknown[]) => priceCatalogCacheFindFirst(...a),
  },
  $executeRaw: (...a: unknown[]) => executeRaw(...a),
  $transaction: async (fn: (tx: unknown) => unknown) => fn(mockPrisma),
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/telegram", () => ({ sendTelegramMessage: (...a: unknown[]) => sendTelegramMessageMock(...a) }));

// Só pra provar que uma sync em andamento (lock já ativo) não dispara doSync() de novo (ponto B
// do pedido do Rodrigo: "garantir que uma sincronização em andamento não seja considerada
// parada") — createDapicClients é o primeiro passo real de doSync(); se ele for chamado, a sync
// tentou rodar de novo por cima da que já está rodando.
// Tipado explicitamente (não inferido do throw) — sem isso, TS infere o retorno como `never` e o
// `.mockImplementationOnce(() => [clientA, clientB])` do teste de integração mais abaixo não compila.
const createDapicClientsMock = vi.fn<() => DapicClient[]>(() => {
  throw new Error("createDapicClients NÃO deveria ser chamado quando o lock já está ativo");
});
vi.mock("@/lib/connectors/dapic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/dapic")>();
  // sleep real (escalonamento de 2s entre tokens, ver STAGGER_MS em sync-runner.ts) deixaria o
  // teste de integração "falha de 1 loja não derruba as outras" (abaixo) esperando segundos de
  // verdade — sem valor nenhum pro teste, só mais lento. Tempo é a única coisa sobrescrita aqui.
  return { ...actual, createDapicClients: () => createDapicClientsMock(), sleep: () => Promise.resolve() };
});

// fetchPriceCatalogCached bate em prisma.priceCatalogCache (modelo não usado em mais nenhum outro
// teste deste arquivo) — mockado pra devolver um catálogo vazio direto, sem precisar simular esse
// model só pro teste de integração abaixo. inferTabelaPreco (usado meio a meio dentro do sync)
// continua sendo a implementação real.
vi.mock("@/lib/connectors/tabela-preco", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/tabela-preco")>();
  return { ...actual, fetchPriceCatalogCached: async () => new Map() };
});

function fakeClient(label: string, armazenadores: { Id: number; Descricao: string }[]): DapicClient {
  return {
    label,
    fetchArmazenadores: () => Promise.resolve(armazenadores),
  } as unknown as DapicClient;
}

beforeEach(() => {
  storeFindFirst.mockReset();
  storeFindMany.mockReset().mockResolvedValue([]);
  storeUpdate.mockReset();
  storeCreate.mockReset();
  armazensConhecidosSimulados = new Map();
  armazemConhecidoCreate.mockClear();
  armazemConhecidoFindMany.mockClear();
  armazemConhecidoUpdate.mockClear();
  syncLockFindMany.mockReset().mockResolvedValue([]);
  syncLockUpsert.mockReset();
  syncLockUpdate.mockReset().mockResolvedValue(undefined);
  syncLockFindUnique.mockReset().mockResolvedValue(null);
  syncLogFindFirst.mockReset().mockResolvedValue(null);
  priceCatalogCacheFindFirst.mockReset().mockResolvedValue(null);
  parcelaDeleteMany.mockReset();
  parcelaCreateMany.mockReset().mockResolvedValue({ count: 0 });
  giftFindMany.mockReset().mockResolvedValue([]);
  clienteCadastroFindMany.mockReset().mockResolvedValue([]);
  saleFindMany.mockReset().mockResolvedValue([]);
  saleUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  returnFindMany.mockReset().mockResolvedValue([]);
  returnUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  syncLogCreate.mockReset().mockResolvedValue({});
  executeRaw.mockClear();
  sendTelegramMessageMock.mockClear();
  createDapicClientsMock.mockClear();
});

// Item 7 — âncora de primaryStoreId por code conhecido, não por ordem de array (causa raiz do
// incidente "Conserto": 5 dias de venda real do Site gravada no armazém errado).
describe("syncArmazenadores — âncora do primaryStoreId e alerta de armazém novo", () => {
  it("armazém novo (tipo 'Conserto') antes de CD na resposta NÃO rouba o primaryStoreId quando há âncora configurada", async () => {
    storeFindFirst.mockImplementation(({ where }: { where: { OR: { code?: string; dapicArmazenadorId?: number }[] } }) => {
      const code = where.OR[0].code;
      if (code === "CD") return Promise.resolve({ id: "store-cd" });
      return Promise.resolve(null);
    });
    storeCreate.mockImplementation(({ data }: { data: { code: string } }) =>
      Promise.resolve({ id: `store-${data.code.toLowerCase()}` })
    );
    storeUpdate.mockResolvedValue({ id: "store-cd" }); // CD já existe -> passa pelo ramo update()

    const client = fakeClient("cd-atacado", [
      { Id: 99, Descricao: "Conserto (enviados para conserto aguardando retor)" }, // vem ANTES de CD
      { Id: 3, Descricao: "CD" },
    ]);

    const { syncArmazenadores } = await import("../sync-runner");
    const resultado = await syncArmazenadores(client);

    expect(resultado.primaryStoreId).toBe("store-cd");
  });

  it("CD ausente na resposta da API, mas já existe no banco -> usa o registro conhecido + alerta", async () => {
    storeFindFirst.mockResolvedValue(null); // "Conserto" é novo, não existe ainda
    storeCreate.mockResolvedValue({ id: "store-conserto" });
    // findFirst({ where: { code: "CD" } }) do fallback (sem OR) precisa devolver o registro existente.
    storeFindFirst.mockImplementation((args: { where: { OR?: unknown[]; code?: string } }) => {
      if (args.where.code === "CD" && !args.where.OR) return Promise.resolve({ id: "store-cd-existente" });
      return Promise.resolve(null);
    });

    const client = fakeClient("cd-atacado", [{ Id: 99, Descricao: "Conserto novo" }]);

    const { syncArmazenadores } = await import("../sync-runner");
    const resultado = await syncArmazenadores(client);

    expect(resultado.primaryStoreId).toBe("store-cd-existente");
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(expect.stringContaining('"CD" não veio na resposta da API'), expect.anything());
  });

  it("CD ausente na API E no banco -> primaryStoreId fica null (nunca grava venda no lugar errado) + alerta crítico", async () => {
    storeFindFirst.mockResolvedValue(null);
    storeCreate.mockResolvedValue({ id: "store-outro" });

    const client = fakeClient("cd-atacado", [{ Id: 99, Descricao: "Armazém Desconhecido" }]);

    const { syncArmazenadores } = await import("../sync-runner");
    const resultado = await syncArmazenadores(client);

    expect(resultado.primaryStoreId).toBeNull();
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(expect.stringContaining("NÃO serão sincronizadas"), expect.anything());
  });

  it("armazém com code nunca visto antes dispara alerta de 'armazém novo' uma única vez", async () => {
    armazensConhecidosSimulados.set("cd-atacado::3", { nomeAtual: "CD", classificacao: "VENDE" }); // CD já é conhecido; "Armazém Nunca Visto" (Id 77) não
    storeFindFirst.mockImplementation(({ where }: { where: { OR?: { code?: string }[]; code?: string } }) => {
      const code = where.OR?.[0]?.code ?? where.code;
      if (code === "CD") return Promise.resolve({ id: "store-cd" });
      return Promise.resolve(null);
    });
    storeCreate.mockResolvedValue({ id: "store-novo" });
    storeUpdate.mockResolvedValue({ id: "store-cd" }); // CD já existe -> passa pelo ramo update()

    const client = fakeClient("cd-atacado", [
      { Id: 3, Descricao: "CD" },
      { Id: 77, Descricao: "Armazém Nunca Visto" },
    ]);

    const { syncArmazenadores } = await import("../sync-runner");
    await syncArmazenadores(client);

    const chamadasDeAlertaNovo = sendTelegramMessageMock.mock.calls.filter(([msg]) => (msg as string).includes("Armazém novo encontrado"));
    expect(chamadasDeAlertaNovo).toHaveLength(1);
    expect(chamadasDeAlertaNovo[0][0]).toContain("Armazém Nunca Visto");
  });

  it("token sem âncora configurada mantém o comportamento antigo (primeiro que vende)", async () => {
    storeFindFirst.mockResolvedValue(null);
    storeCreate.mockImplementation(({ data }: { data: { code: string } }) => Promise.resolve({ id: `store-${data.code}` }));

    const client = fakeClient("leblon", [{ Id: 6, Descricao: "Leblon" }]);

    const { syncArmazenadores } = await import("../sync-runner");
    const resultado = await syncArmazenadores(client);

    expect(resultado.primaryStoreId).toBe("store-Leblon");
  });
});

// Item 1 — os 3 tipos de lock (sync/recovery/cancelamentos) agora se bloqueiam mutuamente.
describe("acquireSyncLock — bloqueio mútuo entre sync/recovery/cancelamentos", () => {
  it("lock 'sync' ativo (não-stale) bloqueia tentativa de adquirir 'recovery'", async () => {
    const agora = new Date();
    syncLockFindMany.mockResolvedValue([{ id: "sync", startedAt: agora, finishedAt: null }]);

    const { acquireSyncLock, RECOVERY_LOCK_ID } = await import("../sync-runner");
    const ok = await acquireSyncLock(RECOVERY_LOCK_ID, 20);

    expect(ok).toBe(false);
    expect(syncLockUpsert).not.toHaveBeenCalled();
  });

  it("lock 'sync' stale (passou do staleMin) NÃO bloqueia 'recovery'", async () => {
    const dezMinutosAtras = new Date(Date.now() - 10 * 60_000);
    syncLockFindMany.mockResolvedValue([{ id: "sync", startedAt: dezMinutosAtras, finishedAt: null }]); // staleMin do "sync" é 6

    const { acquireSyncLock, RECOVERY_LOCK_ID } = await import("../sync-runner");
    const ok = await acquireSyncLock(RECOVERY_LOCK_ID, 20);

    expect(ok).toBe(true);
    expect(syncLockUpsert).toHaveBeenCalledTimes(1);
  });

  it("nenhum lock ativo -> adquire normalmente", async () => {
    syncLockFindMany.mockResolvedValue([]);

    const { acquireSyncLock, SYNC_LOCK_ID } = await import("../sync-runner");
    const ok = await acquireSyncLock(SYNC_LOCK_ID, 6);

    expect(ok).toBe(true);
  });

  it("lock 'cancelamentos' ativo bloqueia tentativa de adquirir 'sync'", async () => {
    const agora = new Date();
    syncLockFindMany.mockResolvedValue([{ id: "cancelamentos", startedAt: agora, finishedAt: null }]);

    const { acquireSyncLock, SYNC_LOCK_ID } = await import("../sync-runner");
    const ok = await acquireSyncLock(SYNC_LOCK_ID, 6);

    expect(ok).toBe(false);
  });
});

// Item 2 — reconciliação origem(DAPIC)×destino(Neon), nunca existia antes.
describe("reconciliarLotePersistido", () => {
  it("tudo persistido certo -> null (sem alerta)", async () => {
    const { reconciliarLotePersistido } = await import("../sync-runner");
    const esperado = [{ storeId: "s1", dapicVendaId: 1, itemIndex: 0, valor: 100 }];
    const resultado = await reconciliarLotePersistido("Sale", esperado, () =>
      Promise.resolve([{ storeId: "s1", dapicVendaId: 1, itemIndex: 0, valor: 100 }])
    );
    expect(resultado).toBeNull();
  });

  it("1 linha faltando no banco -> faltando:1", async () => {
    const { reconciliarLotePersistido } = await import("../sync-runner");
    const esperado = [{ storeId: "s1", dapicVendaId: 1, itemIndex: 0, valor: 100 }];
    const resultado = await reconciliarLotePersistido("Sale", esperado, () => Promise.resolve([]));
    expect(resultado).toEqual(expect.objectContaining({ tabela: "Sale", faltando: 1, divergente: 0, total: 1 }));
  });

  it("1 linha com valor diferente -> divergente:1", async () => {
    const { reconciliarLotePersistido } = await import("../sync-runner");
    const esperado = [{ storeId: "s1", dapicVendaId: 1, itemIndex: 0, valor: 100 }];
    const resultado = await reconciliarLotePersistido("Sale", esperado, () =>
      Promise.resolve([{ storeId: "s1", dapicVendaId: 1, itemIndex: 0, valor: 50 }])
    );
    expect(resultado).toEqual(expect.objectContaining({ faltando: 0, divergente: 1 }));
  });

  it("diferença de até R$0,01 (arredondamento float) NÃO conta como divergência", async () => {
    const { reconciliarLotePersistido } = await import("../sync-runner");
    const esperado = [{ storeId: "s1", dapicVendaId: 1, itemIndex: 0, valor: 100 }];
    const resultado = await reconciliarLotePersistido("Sale", esperado, () =>
      Promise.resolve([{ storeId: "s1", dapicVendaId: 1, itemIndex: 0, valor: 100.009 }])
    );
    expect(resultado).toBeNull();
  });

  it("lista esperada vazia -> null sem nem consultar o banco", async () => {
    const { reconciliarLotePersistido } = await import("../sync-runner");
    const buscar = vi.fn();
    const resultado = await reconciliarLotePersistido("Gift", [], buscar);
    expect(resultado).toBeNull();
    expect(buscar).not.toHaveBeenCalled();
  });
});

// Item 6 — Gift passa a ser upsert (atualiza colecao), não createMany+skipDuplicates imutável.
describe("upsertGiftsComColecaoAtualizavel", () => {
  it("não faz nada quando a lista está vazia", async () => {
    const { upsertGiftsComColecaoAtualizavel } = await import("../sync-runner");
    await upsertGiftsComColecaoAtualizavel([]);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("chama $executeRaw (upsert) uma vez para o lote, não createMany", async () => {
    const { upsertGiftsComColecaoAtualizavel } = await import("../sync-runner");
    await upsertGiftsComColecaoAtualizavel([
      {
        storeId: "s1",
        cod: "C1",
        produto: "Produto X",
        grupo: "Grupo X",
        quantidade: 1,
        valorTotalLiquido: 0,
        giftDate: new Date(),
        dapicVendaId: 1,
        itemIndex: 0,
      },
    ]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});

// Item 5 — Parcela: delete+insert agora dentro de uma única transação (antes eram 2 chamadas
// top-level separadas, com janela real de tabela vazia entre elas).
describe("syncParcelas — delete+insert dentro de uma transação", () => {
  it("delete e insert acontecem dentro do MESMO $transaction, não como chamadas top-level separadas", async () => {
    const client = {
      label: "cd-atacado",
      fetchParcelas: () =>
        Promise.resolve([
          {
            IdParcela: 1,
            IdConta: 1,
            Status: "Aberta",
            DataEmissao: "2026-01-01T00:00:00",
            DataVencimento: "2026-02-01T00:00:00",
            Conta: "Conta X",
            FormaPagamento: "Boleto",
            Pessoa: "Cliente X",
            Parcela: 1,
            Valor: 100,
            ValorPago: 0,
            ValorAberto: 100,
            ValorMulta: 0,
            ValorJuros: 0,
          },
        ]),
    } as unknown as DapicClient;

    parcelaCreateMany.mockResolvedValue({ count: 1 });

    const { syncParcelas } = await import("../sync-runner");
    const count = await syncParcelas(client);

    expect(count).toBe(1);
    expect(parcelaDeleteMany).toHaveBeenCalledTimes(1);
    expect(parcelaCreateMany).toHaveBeenCalledTimes(1);
  });

  it("parcela com data inválida é ignorada, não derruba o lote inteiro", async () => {
    const client = {
      label: "cd-atacado",
      fetchParcelas: () =>
        Promise.resolve([
          {
            IdParcela: 1,
            IdConta: 1,
            Status: "Aberta",
            DataEmissao: "data-invalida",
            DataVencimento: "2026-02-01T00:00:00",
            Conta: "Conta X",
            FormaPagamento: "Boleto",
            Pessoa: "Cliente X",
            Parcela: 1,
            Valor: 100,
            ValorPago: 0,
            ValorAberto: 100,
            ValorMulta: 0,
            ValorJuros: 0,
          },
        ]),
    } as unknown as DapicClient;

    const { syncParcelas } = await import("../sync-runner");
    await syncParcelas(client);

    expect(parcelaCreateMany).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Validação direcionada pedida pelo Rodrigo em 2026-10-30 (ponto A, B, C, D) — além dos testes
// dos 7 itens já escritos acima.
// ============================================================================

// Ponto A — ausência do CD na resposta da API (sem fallback no banco também).
describe("Ponto A — ausência do CD: nenhuma venda associada incorretamente", () => {
  it("syncVendas com storeId=null retorna 0 SEM chamar a API (não tenta associar venda a lugar nenhum)", async () => {
    const fetchVendasPdv = vi.fn(() => {
      throw new Error("não deveria buscar vendas quando storeId (primaryStoreId) é null");
    });
    const client = { label: "cd-atacado", fetchVendasPdv } as unknown as DapicClient;

    const { syncVendas } = await import("../sync-runner");
    const resultado = await syncVendas(client, null, null, 1, new Map());

    expect(resultado).toEqual({ vendas: 0, devolucoes: 0, brindes: 0, vendedorCorrigido: [], divergencias: [] });
    expect(fetchVendasPdv).not.toHaveBeenCalled();
  });

  it("syncFaturas com storeId=null retorna 0 SEM chamar a API", async () => {
    const fetchFaturas = vi.fn(() => {
      throw new Error("não deveria buscar faturas quando storeId é null");
    });
    const client = { label: "cd-atacado", fetchFaturas } as unknown as DapicClient;

    const { syncFaturas } = await import("../sync-runner");
    const resultado = await syncFaturas(client, null, null, 1, new Map());

    expect(resultado).toEqual({ vendas: 0, brindes: 0, divergencias: [] });
    expect(fetchFaturas).not.toHaveBeenCalled();
  });

  // Achado na validação: quando o CD não existe NEM na API nem no banco, syncArmazenadores NÃO
  // lança erro (só alerta) — primaryStoreId fica null e o restante do syncOneClient roda normal
  // (estoque sincroniza, vendas/faturas retornam 0 sem erro). Isso significa que esse cenário
  // NÃO aparece como FAILED no SyncLog — só o alerta Telegram sinaliza. Documentado como risco
  // conhecido no relatório (não é um bug introduzido agora, é uma limitação real do desenho).
  it("CD ausente em todo lugar -> syncArmazenadores não lança erro (resultado seria reportado como SUCCESS com 0 vendas, não FAILED)", async () => {
    storeFindFirst.mockResolvedValue(null);
    storeCreate.mockResolvedValue({ id: "store-outro" });

    const client = fakeClient("cd-atacado", [{ Id: 99, Descricao: "Armazém Desconhecido" }]);
    const { syncArmazenadores } = await import("../sync-runner");

    await expect(syncArmazenadores(client)).resolves.toEqual(
      expect.objectContaining({ primaryStoreId: null })
    );
  });

  it("janela normal de 1 dia continua processando vendas do CD assim que ele volta a aparecer (sem ação manual) — preservação é 'não perder o dado na origem', não 'reprocessar automaticamente um gap já fora da janela'", async () => {
    // Confirma que, com storeId preenchido normalmente (CD de volta), syncVendas tenta buscar —
    // ou seja, não existe nenhum estado "travado" deixado pelo ciclo anterior sem CD.
    const fetchVendasPdv = vi.fn().mockResolvedValue([]);
    const client = { label: "cd-atacado", fetchVendasPdv } as unknown as DapicClient;

    const { syncVendas } = await import("../sync-runner");
    await syncVendas(client, "store-cd", null, 1, new Map());

    expect(fetchVendasPdv).toHaveBeenCalledTimes(1);
  });
});

// Ponto B — self-heal não pode duplicar uma sync já em andamento (lock).
describe("Ponto B — runSync() respeita o lock: não re-executa sync em andamento", () => {
  it("lock 'sync' já ativo -> runSync() devolve skipped e NUNCA chega a chamar createDapicClients (doSync não roda)", async () => {
    syncLockFindMany.mockResolvedValue([{ id: "sync", startedAt: new Date(), finishedAt: null }]);

    const { runSync } = await import("../sync-runner");
    const response = await runSync();
    const body = await response.json();

    expect(body).toEqual(expect.objectContaining({ ok: true, skipped: true }));
    expect(createDapicClientsMock).not.toHaveBeenCalled();
  });

  it("nenhum lock ativo -> acquireSyncLock libera (doSync chegaria a rodar; não validamos doSync aqui, só que o lock não bloqueia à toa)", async () => {
    syncLockFindMany.mockResolvedValue([]);

    const { acquireSyncLock, SYNC_LOCK_ID, releaseSyncLock } = await import("../sync-runner");
    const ok = await acquireSyncLock(SYNC_LOCK_ID, 6);
    expect(ok).toBe(true);
    await releaseSyncLock(SYNC_LOCK_ID); // não deixa lock "travado" pros outros testes
  });
});

// Ponto C — Telegram: alerta enviado, controle de repetição, e falha no envio não derruba a sync.
describe("Ponto C — Telegram: alerta, repetição e resiliência a falha", () => {
  it("alerta de armazém novo NÃO repete depois que o armazém já foi persistido (ciclo seguinte)", async () => {
    storeFindFirst.mockImplementation(({ where }: { where: { OR?: { code?: string }[]; code?: string } }) => {
      const code = where.OR?.[0]?.code ?? where.code;
      return code === "CD" ? Promise.resolve({ id: "store-cd" }) : Promise.resolve(null);
    });
    storeUpdate.mockResolvedValue({ id: "store-cd" });
    storeCreate.mockResolvedValue({ id: "store-novo" });

    const { syncArmazenadores } = await import("../sync-runner");
    const client1 = fakeClient("cd-atacado", [{ Id: 3, Descricao: "CD" }, { Id: 77, Descricao: "Novo Armazem" }]);

    armazensConhecidosSimulados.set("cd-atacado::3", { nomeAtual: "CD", classificacao: "VENDE" }); // 1º ciclo: CD já conhecido, "Novo Armazem" (Id 77) ainda não
    await syncArmazenadores(client1);
    const alertasNovo1 = sendTelegramMessageMock.mock.calls.filter(([m]) => (m as string).includes("Armazém novo encontrado"));
    expect(alertasNovo1).toHaveLength(1);

    sendTelegramMessageMock.mockClear();
    // 2º ciclo: "Novo Armazem" já foi persistido pelo 1º ciclo (ver create() acima, que grava em
    // armazensConhecidosSimulados de verdade) — não precisa semear nada, é o comportamento real.
    const client2 = fakeClient("cd-atacado", [{ Id: 3, Descricao: "CD" }, { Id: 77, Descricao: "Novo Armazem" }]);
    await syncArmazenadores(client2);
    const alertasNovo2 = sendTelegramMessageMock.mock.calls.filter(([m]) => (m as string).includes("Armazém novo encontrado"));
    expect(alertasNovo2).toHaveLength(0);
  });

  // Achado real na validação: diferente do alerta de "armazém novo" (que se autossuprime, ver
  // teste acima), o alerta de "CD ausente" NÃO tem nenhum controle de repetição — se o CD
  // continuar ausente por vários ciclos seguidos, o alerta dispara em TODOS eles (a cada ~10min
  // no sync frequente). Não é destrutivo (o alerta é informativo), mas é risco real de fadiga de
  // alerta. Documentado como risco em aberto no relatório, não corrigido nesta validação (seria
  // mudança de comportamento não aprovada ainda pelo Rodrigo).
  it("[risco conhecido] alerta de 'CD ausente' REPETE em ciclos consecutivos, sem controle de dedup", async () => {
    storeFindFirst.mockResolvedValue(null);
    storeCreate.mockResolvedValue({ id: "store-outro" });

    const { syncArmazenadores } = await import("../sync-runner");
    const client = fakeClient("cd-atacado", [{ Id: 99, Descricao: "Armazém Desconhecido" }]);

    await syncArmazenadores(client);
    await syncArmazenadores(client);

    const alertasCritico = sendTelegramMessageMock.mock.calls.filter(([m]) => (m as string).includes("NÃO serão sincronizadas"));
    expect(alertasCritico).toHaveLength(2); // comportamento ATUAL — ver nota acima
  });

  it("Telegram falhando ao enviar o alerta de CD ausente NÃO lança erro (sync não é interrompida por isso)", async () => {
    storeFindFirst.mockResolvedValue(null);
    storeCreate.mockResolvedValue({ id: "store-outro" });
    sendTelegramMessageMock.mockRejectedValueOnce(new Error("Telegram fora do ar"));

    const { syncArmazenadores } = await import("../sync-runner");
    const client = fakeClient("cd-atacado", [{ Id: 99, Descricao: "Armazém Desconhecido" }]);

    await expect(syncArmazenadores(client)).resolves.toEqual(expect.objectContaining({ primaryStoreId: null }));
  });

  it("Telegram falhando no alerta de 'armazém novo' também não lança erro", async () => {
    storeFindFirst.mockResolvedValue({ id: "store-cd" });
    storeUpdate.mockResolvedValue({ id: "store-cd" });
    sendTelegramMessageMock.mockRejectedValueOnce(new Error("Telegram fora do ar"));

    const { syncArmazenadores } = await import("../sync-runner");
    const client = fakeClient("leblon", [{ Id: 77, Descricao: "Armazém Novo Qualquer" }]);

    await expect(syncArmazenadores(client)).resolves.toBeDefined();
  });
});

// Ponto D — integridade: sync repetida sem duplicação, classificação por loja, nada descartado em silêncio.
describe("Ponto D — integridade: idempotência real (ON CONFLICT) e classificação de lojas", () => {
  it("upsertSalesComVendedorAtualizavel usa ON CONFLICT ... DO UPDATE (upsert real, não INSERT puro)", async () => {
    const { upsertSalesComVendedorAtualizavel } = await import("../sync-runner");
    await upsertSalesComVendedorAtualizavel([
      { storeId: "s1", cod: "C1", produto: "P1", grupo: "G1", quantidade: 1, valorTotalLiquido: 10, saleDate: new Date(), dapicVendaId: 1, itemIndex: 0 },
    ]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const templateStrings = (executeRaw.mock.calls[0][0] as string[]).join(" ");
    expect(templateStrings).toContain("ON CONFLICT");
    expect(templateStrings).toContain("DO UPDATE");
  });

  it("upsertReturnsComColecaoAtualizavel usa ON CONFLICT ... DO UPDATE", async () => {
    const { upsertReturnsComColecaoAtualizavel } = await import("../sync-runner");
    await upsertReturnsComColecaoAtualizavel([
      { storeId: "s1", cod: "C1", produto: "P1", grupo: "G1", quantidade: 1, valorTotal: 10, returnDate: new Date(), dapicVendaId: 1, itemIndex: 0 },
    ]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const templateStrings = (executeRaw.mock.calls[0][0] as string[]).join(" ");
    expect(templateStrings).toContain("ON CONFLICT");
  });

  it("upsertGiftsComColecaoAtualizavel usa ON CONFLICT ... DO UPDATE", async () => {
    const { upsertGiftsComColecaoAtualizavel } = await import("../sync-runner");
    await upsertGiftsComColecaoAtualizavel([
      { storeId: "s1", cod: "C1", produto: "P1", grupo: "G1", quantidade: 1, valorTotalLiquido: 10, giftDate: new Date(), dapicVendaId: 1, itemIndex: 0 },
    ]);
    const templateStrings = (executeRaw.mock.calls[0][0] as string[]).join(" ");
    expect(templateStrings).toContain("ON CONFLICT");
  });

  it("CD e ATACADO no mesmo token são classificados em stores DIFERENTES, primaryStoreId é sempre CD", async () => {
    storeFindFirst.mockResolvedValue(null);
    storeCreate.mockImplementation(({ data }: { data: { code: string } }) => Promise.resolve({ id: `store-${data.code}` }));

    const { syncArmazenadores } = await import("../sync-runner");
    const client = fakeClient("cd-atacado", [
      { Id: 3, Descricao: "CD" },
      { Id: 14, Descricao: "ATACADO" },
    ]);
    const resultado = await syncArmazenadores(client);

    expect(resultado.primaryStoreId).toBe("store-CD");
    expect(resultado.atacadoStoreId).toBe("store-ATACADO");
    expect(resultado.primaryStoreId).not.toBe(resultado.atacadoStoreId);
  });

  it.each(["leblon", "rio-sul", "barra"])("loja física '%s' sem âncora configurada continua recebendo seu primaryStoreId normalmente", async (label) => {
    storeFindFirst.mockResolvedValue(null);
    storeCreate.mockResolvedValue({ id: `store-${label}` });

    const { syncArmazenadores } = await import("../sync-runner");
    const client = fakeClient(label, [{ Id: 1, Descricao: label === "rio-sul" ? "Rio Sul" : label[0].toUpperCase() + label.slice(1) }]);
    const resultado = await syncArmazenadores(client);

    expect(resultado.primaryStoreId).toBe(`store-${label}`);
  });

  it("reconciliação detecta quando SÓ 1 de vários registros esperados falta persistir (não mascara os outros)", async () => {
    const { reconciliarLotePersistido } = await import("../sync-runner");
    const esperado = [
      { storeId: "s1", dapicVendaId: 1, itemIndex: 0, valor: 10 },
      { storeId: "s1", dapicVendaId: 2, itemIndex: 0, valor: 20 },
      { storeId: "s1", dapicVendaId: 3, itemIndex: 0, valor: 30 },
    ];
    const resultado = await reconciliarLotePersistido("Sale", esperado, () =>
      Promise.resolve([
        { storeId: "s1", dapicVendaId: 1, itemIndex: 0, valor: 10 },
        // dapicVendaId 2 "desapareceu" na persistência
        { storeId: "s1", dapicVendaId: 3, itemIndex: 0, valor: 30 },
      ])
    );
    expect(resultado).toEqual(expect.objectContaining({ faltando: 1, divergente: 0, total: 3 }));
    expect(resultado?.exemplos[0]).toContain("::2::");
  });
});

// ============================================================================
// Preparado pelo agente de QA da missão Black Friday (2026-11-05) — cobertura pedida: "falha
// parcial de uma fonte não derruba as outras" exercitada de ponta a ponta (runSync -> doSync ->
// syncOneClient por token), não só os blocos isolados acima (storeId=null, Telegram falhando).
// ============================================================================
describe("runSync — falha TOTAL de 1 loja não derruba as outras (integração via doSync)", () => {
  it("loja B falha em fetchArmazenadores -> loja A sincroniza normalmente, resultado final soma o que A produziu sem zerar por causa de B", async () => {
    storeFindFirst.mockResolvedValue(null); // nenhum Store pré-existente
    storeCreate.mockImplementation(({ data }: { data: { code: string } }) => Promise.resolve({ id: `store-${data.code}` }));

    const clientA = {
      label: "loja-a",
      fetchArmazenadores: () => Promise.resolve([{ Id: 1, Descricao: "Loja A" }]),
      fetchEstoqueTodosArmazenadores: () =>
        Promise.resolve([
          { IdArmazenador: 1, IdGradeProduto: 500, Produto: "Camisa X", Grupo: "Camisas", QuantidadeReal: 10 },
        ]),
      fetchVendasPdv: () =>
        Promise.resolve([
          {
            Id: 777,
            Status: "Fechada",
            DataFechamento: "2026-11-01T10:00:00",
            Codigo: "V777",
            Cliente: "Cliente Qualquer",
            Vendedor: "Vendedor X",
            Cidade: null,
            Produtos: [
              {
                Tipo: "Venda",
                IdGradeProduto: 500,
                Produto: "Camisa X",
                Grupo: "Camisas",
                Quantidade: 1,
                ValorLiquido: 100,
                ValorUnitario: 100,
              },
            ],
          },
        ]),
      fetchVendaPdvDetalhe: () => Promise.resolve(null),
      fetchVendasPdvModificadas: () => Promise.resolve([]),
    } as unknown as DapicClient;

    const clientB = {
      label: "loja-b",
      // Simula um token com login/rede fora do ar — falha ANTES de qualquer dado da loja B ser
      // tocado (nenhum dos outros métodos de clientB é chamado, de propósito: documenta que a
      // falha é travada já no 1º passo de syncOneClient, "armazenadores").
      fetchArmazenadores: () => Promise.reject(new Error("DAPIC: token da loja B expirou")),
    } as unknown as DapicClient;

    createDapicClientsMock.mockImplementationOnce(() => [clientA, clientB]);

    const { runSync } = await import("../sync-runner");
    const response = await runSync({ silent: true });
    const body = await response.json();

    expect(body.ok).toBe(true);
    // O resultado agregado não "zera" o que a loja A produziu de verdade por causa da falha de B.
    expect(body.estoque).toBeGreaterThanOrEqual(1);
    expect(body.vendas).toBeGreaterThanOrEqual(1);
    // A falha de B aparece isolada e identificada — nunca silenciosa, nunca misturada com o
    // resultado de A.
    expect(body.falhasParciais).toHaveLength(1);
    expect(body.falhasParciais[0]).toContain("loja-b");
    expect(body.falhasParciais[0]).toContain("armazenadores");
  });
});

// Missão Black Friday (2026-11, continuação) — fecha a lacuna já documentada no relatório
// anterior (achado #3): Meta Ads/GA4 agora têm SyncSource próprio (META_ADS/GA4, ver
// prisma/schema.prisma) e analytics-site/page.tsx grava um SyncLog por fonte a cada carregamento
// real da aba. getSyncStatusDetalhado() precisa ler esse SyncLog de verdade, não mais devolver o
// placeholder `rastreiaErro: false` fixo de antes.
describe("getSyncStatusDetalhado — Meta Ads/GA4 usam SyncLog de verdade (não mais placeholder)", () => {
  it("META_ADS com último SyncLog FAILED -> status/message refletem a falha real, não um placeholder fixo", async () => {
    syncLogFindFirst.mockImplementation(({ where }: { where: { source: string } }) => {
      if (where.source === "META_ADS") {
        return Promise.resolve({
          status: "FAILED",
          finishedAt: new Date("2026-11-05T09:00:00.000Z"),
          recordsSynced: 0,
          message: "Meta Ads API: token expirado",
        });
      }
      return Promise.resolve(null);
    });

    const { getSyncStatusDetalhado } = await import("../sync-runner");
    const detalhado = await getSyncStatusDetalhado();

    expect(detalhado.metaAds).toEqual(
      expect.objectContaining({
        source: "META_ADS",
        status: "FAILED",
        message: "Meta Ads API: token expirado",
        finishedAt: "2026-11-05T09:00:00.000Z",
      })
    );
  });

  it("GA4 com último SyncLog SUCCESS -> status SUCCESS refletido (antes era sempre rastreiaErro:false, nunca refletia sucesso nem falha de verdade)", async () => {
    syncLogFindFirst.mockImplementation(({ where }: { where: { source: string } }) => {
      if (where.source === "GA4") {
        return Promise.resolve({ status: "SUCCESS", finishedAt: new Date("2026-11-05T09:30:00.000Z"), recordsSynced: 30, message: null });
      }
      return Promise.resolve(null);
    });

    const { getSyncStatusDetalhado } = await import("../sync-runner");
    const detalhado = await getSyncStatusDetalhado();

    expect(detalhado.ga4).toEqual(
      expect.objectContaining({ source: "GA4", status: "SUCCESS", recordsSynced: 30, ultimaAtualizacaoCache: null })
    );
  });

  it("nenhum SyncLog ainda pra META_ADS/GA4 (aba Analytics nunca foi aberta) -> status null, não erro", async () => {
    syncLogFindFirst.mockResolvedValue(null);

    const { getSyncStatusDetalhado } = await import("../sync-runner");
    const detalhado = await getSyncStatusDetalhado();

    expect(detalhado.metaAds.status).toBeNull();
    expect(detalhado.ga4.status).toBeNull();
  });

  it("metaAds.ultimaAtualizacaoCache continua vindo do PriceCatalogCache (frescor de foto/status, ortogonal ao SyncLog de insight)", async () => {
    syncLogFindFirst.mockResolvedValue(null);
    priceCatalogCacheFindFirst.mockResolvedValue({ updatedAt: new Date("2026-11-04T08:00:00.000Z") });

    const { getSyncStatusDetalhado } = await import("../sync-runner");
    const detalhado = await getSyncStatusDetalhado();

    expect(detalhado.metaAds.ultimaAtualizacaoCache).toBe("2026-11-04T08:00:00.000Z");
    expect(detalhado.ga4.ultimaAtualizacaoCache).toBeNull(); // GA4 nunca teve cache de dado equivalente
  });
});
