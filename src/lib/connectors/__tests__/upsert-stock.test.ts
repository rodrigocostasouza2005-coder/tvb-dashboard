import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { upsertStockSnapshots, upsertStockSnapshotsDiario, type StockSnapshotRow } from "../upsert-stock";

const executeRaw = vi.fn().mockResolvedValue(undefined);
const fakePrisma = { $executeRaw: (...a: unknown[]) => executeRaw(...a) } as unknown as PrismaClient;

function row(overrides: Partial<StockSnapshotRow> = {}): StockSnapshotRow {
  return {
    storeId: "store-1",
    cod: "C1",
    produto: "Camisa X",
    grupo: "Camisas",
    cor: null,
    tamanho: null,
    colecao: null,
    quantidadeDisponivel: 10,
    estoqueMinimo: null,
    valorCusto: 50,
    ...overrides,
  };
}

beforeEach(() => {
  executeRaw.mockClear();
});

// StockSnapshotDiario (2026-11-19) — histórico diário real de estoque, ao lado de StockSnapshot
// (valor atual, sem série no tempo). A chave de conflito (storeId, cod, data) é o que garante que
// o cron rodando várias vezes ao dia (vercel.json) grave 1 linha por dia só, nunca duplicada.
describe("upsertStockSnapshotsDiario", () => {
  it("não faz nada quando a lista está vazia", async () => {
    const total = await upsertStockSnapshotsDiario(fakePrisma, [], new Date("2026-11-19T00:00:00-03:00"));
    expect(total).toBe(0);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("usa ON CONFLICT (storeId, cod, data) ... DO UPDATE — upsert real, não INSERT puro", async () => {
    await upsertStockSnapshotsDiario(fakePrisma, [row()], new Date("2026-11-19T00:00:00-03:00"));

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const templateStrings = (executeRaw.mock.calls[0][0] as string[]).join(" ");
    expect(templateStrings).toContain("ON CONFLICT");
    expect(templateStrings).toContain("DO UPDATE");
    // A chave de conflito precisa ser EXATAMENTE storeId+cod+data (não só storeId+cod, que é a
    // chave de StockSnapshot) — senão duas rows do mesmo dia em lojas/cods diferentes colidiriam
    // entre si, ou duas datas diferentes do mesmo cod se sobrescreveriam uma à outra.
    expect(templateStrings).toContain('"storeId", "cod", "data"');
  });

  // Idempotência (pedido explícito do Rodrigo): rodar a gravação do snapshot 2x no MESMO dia (o
  // cron de sync roda várias vezes ao dia, ver vercel.json) não pode duplicar linha — tem que
  // upsertar por cima da mesma linha. Aqui isso é verificado no nível do SQL gerado: as duas
  // chamadas usam a MESMA chave de conflito (storeId, cod, data) com o MESMO valor de "data" —
  // é exatamente essa combinação que faz o Postgres (via a constraint única real, aplicada na
  // migration) colapsar as duas chamadas em 1 linha só, atualizada pela segunda.
  it("chamar duas vezes no mesmo dia gera dois upserts com a MESMA chave (storeId+cod+data) — Postgres colapsa em 1 linha via ON CONFLICT, nunca duplica", async () => {
    const mesmoDia = new Date("2026-11-19T00:00:00-03:00");
    const linha = row({ quantidadeDisponivel: 10 });

    await upsertStockSnapshotsDiario(fakePrisma, [linha], mesmoDia);
    await upsertStockSnapshotsDiario(fakePrisma, [row({ quantidadeDisponivel: 7 })], mesmoDia);

    expect(executeRaw).toHaveBeenCalledTimes(2);
    for (const call of executeRaw.mock.calls) {
      const templateStrings = (call[0] as string[]).join(" ");
      expect(templateStrings).toContain('"storeId", "cod", "data"');
      expect(templateStrings).toContain("DO UPDATE");
    }
    // O valor de "data" passado como parâmetro (não o texto do template, que é fixo) é o mesmo
    // nas duas chamadas — é essa igualdade que faz as duas colidirem na mesma linha no Postgres.
    // $executeRaw é chamado como template tag: calls[i] = [stringsArray, joinedSqlObject] — os
    // valores reais (incluindo "data") ficam em joinedSqlObject.values (Prisma.Sql).
    const valuesCall1 = (executeRaw.mock.calls[0][1] as { values: unknown[] }).values;
    const valuesCall2 = (executeRaw.mock.calls[1][1] as { values: unknown[] }).values;
    const dataParam1 = valuesCall1.find((v) => v instanceof Date);
    const dataParam2 = valuesCall2.find((v) => v instanceof Date);
    expect(dataParam1).toEqual(dataParam2);
  });

  it("chamar em dois dias diferentes usa valores de 'data' diferentes — não deveria colidir (série histórica real, 1 linha por dia)", async () => {
    await upsertStockSnapshotsDiario(fakePrisma, [row()], new Date("2026-11-19T00:00:00-03:00"));
    await upsertStockSnapshotsDiario(fakePrisma, [row()], new Date("2026-11-20T00:00:00-03:00"));

    const valuesCall1 = (executeRaw.mock.calls[0][1] as { values: unknown[] }).values;
    const valuesCall2 = (executeRaw.mock.calls[1][1] as { values: unknown[] }).values;
    const dataParam1 = valuesCall1.find((v) => v instanceof Date) as Date;
    const dataParam2 = valuesCall2.find((v) => v instanceof Date) as Date;
    expect(dataParam1.getTime()).not.toBe(dataParam2.getTime());
  });

  it("respeita batchSize — 2 linhas com batchSize 1 gera 2 chamadas a $executeRaw", async () => {
    await upsertStockSnapshotsDiario(
      fakePrisma,
      [row({ cod: "C1" }), row({ cod: "C2" })],
      new Date("2026-11-19T00:00:00-03:00"),
      1
    );
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("grava o valor de quantidadeDisponivel recebido (não reconsulta nem recalcula nada)", async () => {
    await upsertStockSnapshotsDiario(fakePrisma, [row({ quantidadeDisponivel: 42 })], new Date("2026-11-19T00:00:00-03:00"));
    const values = (executeRaw.mock.calls[0][1] as { values: unknown[] }).values;
    expect(values).toContain(42);
  });
});

// Garante que a extensão não quebrou a função original (StockSnapshot, valor atual) — mesma
// chave de conflito de antes (storeId, cod), sem a coluna "data".
describe("upsertStockSnapshots (valor atual — sem regressão)", () => {
  it("continua usando ON CONFLICT (storeId, cod), sem a coluna data", async () => {
    await upsertStockSnapshots(fakePrisma, [row()]);
    const templateStrings = (executeRaw.mock.calls[0][0] as string[]).join(" ");
    expect(templateStrings).toContain('"storeId", "cod"');
    expect(templateStrings).not.toContain('"storeId", "cod", "data"');
  });
});
