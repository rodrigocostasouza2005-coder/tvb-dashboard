import { describe, it, expect, vi } from "vitest";
import { chaveClienteCidadeEstado } from "../custo";

describe("chaveClienteCidadeEstado — mesma chave usada em getCmvPorCliente e na página", () => {
  it("combina cliente, cidade e estado", () => {
    expect(chaveClienteCidadeEstado("SEADI COMERCIO DE PRODUTOS LTDA", "Touros", "RN")).toBe(
      "SEADI COMERCIO DE PRODUTOS LTDA::Touros::RN"
    );
  });

  it("cidade e estado diferentes do MESMO cliente geram chaves diferentes (não devem se misturar)", () => {
    const k1 = chaveClienteCidadeEstado("SEADI COMERCIO DE PRODUTOS LTDA", "Touros", "RN");
    const k2 = chaveClienteCidadeEstado("SEADI COMERCIO DE PRODUTOS LTDA", "São Miguel do Gostoso", "RN");
    expect(k1).not.toBe(k2);
  });

  it("usa o mesmo fallback '—' que getAtacadoClientes aplica em cidade/estado nulos", () => {
    // getAtacadoClientes (atacado.ts) já converte null -> "—" antes da página ver a linha; se essa
    // função usasse um fallback diferente (ex: ""), a chave nunca bateria e o CMV sumiria (bug
    // silencioso diferente do original, mas igualmente errado).
    expect(chaveClienteCidadeEstado("Cliente X", null, null)).toBe("Cliente X::—::—");
  });
});

// Mocks pro teste de integração do caso real SEADI — cobre toda a cadeia de dependências de
// getCmvPorCliente (getSiteAtacadoStoreIds, canalWhere->getB2BClienteNomes) com retornos neutros;
// só o que importa pro teste (groupBy de vendas + custo por SKU) tem dado de verdade.
const saleGroupBy = vi.fn();
const stockSnapshotFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn().mockResolvedValue([{ id: "store-cd" }, { id: "store-atacado" }]) },
    sale: {
      groupBy: (...a: unknown[]) => saleGroupBy(...a),
      findMany: vi.fn().mockResolvedValue([]), // getB2BClienteNomes
    },
    stockSnapshot: { findMany: (...a: unknown[]) => stockSnapshotFindMany(...a) },
    $queryRaw: vi.fn().mockResolvedValue([]), // join CNPJ dentro de getB2BClienteNomes
  },
}));

describe("getCmvPorCliente — caso real SEADI (2 pedidos, cidades diferentes, mesmo dia)", () => {
  it("calcula o CMV de cada cidade separadamente, sem duplicar o total do cliente em cada linha", async () => {
    saleGroupBy.mockResolvedValue([
      // Pedido 1 (Touros): cod "A" x10 e cod "B" x5
      { cod: "A", clienteNome: "SEADI COMERCIO DE PRODUTOS LTDA", cidade: "Touros", estado: "RN", _sum: { quantidade: 10 } },
      { cod: "B", clienteNome: "SEADI COMERCIO DE PRODUTOS LTDA", cidade: "Touros", estado: "RN", _sum: { quantidade: 5 } },
      // Pedido 2 (São Miguel do Gostoso): cod "A" x8
      { cod: "A", clienteNome: "SEADI COMERCIO DE PRODUTOS LTDA", cidade: "São Miguel do Gostoso", estado: "RN", _sum: { quantidade: 8 } },
    ]);
    stockSnapshotFindMany.mockResolvedValue([
      { cod: "A", valorCusto: 50 },
      { cod: "B", valorCusto: 20 },
    ]);

    const { getCmvPorCliente } = await import("../custo");
    const result = await getCmvPorCliente({
      from: new Date("2026-09-01"),
      to: new Date("2026-09-30"),
      storeIds: undefined,
      marcas: undefined,
      tabelasPreco: undefined,
      grupoIn: undefined,
      tamanhoIn: undefined,
      colecaoIn: undefined,
    });

    const touros = result.find((r) => r.key.includes("Touros"));
    const saoMiguel = result.find((r) => r.key.includes("São Miguel"));

    expect(touros?.cmv).toBe(10 * 50 + 5 * 20); // 600 — só os itens DESSE pedido
    expect(saoMiguel?.cmv).toBe(8 * 50); // 400 — só os itens do OUTRO pedido

    // O bug original faria os dois mostrarem o TOTAL combinado (1000) em cada linha.
    expect(touros?.cmv).not.toBe(600 + 400);
    expect(saoMiguel?.cmv).not.toBe(600 + 400);
  });
});
