import { describe, it, expect, vi, beforeEach } from "vitest";

const saleGroupBy = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-10-31T23:59:59Z");
const baseFilters = { from: FROM, to: TO, storeIds: undefined, marcas: undefined, tabelasPreco: undefined, grupoIn: undefined, tamanhoIn: undefined, colecaoIn: undefined };

describe("getNovosERecorrentesClientes — definição central de novo/recorrente", () => {
  beforeEach(() => {
    saleGroupBy.mockReset();
    queryRaw.mockReset();
  });

  it("primeira compra válida DENTRO do período → novo", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Ana Paula" }]);
    queryRaw
      .mockResolvedValueOnce([{ norm: "ANA PAULA", first: new Date("2026-10-15") }]) // Sale (1ª compra)
      .mockResolvedValueOnce([]); // ClienteCadastro.primeiraCompraExterna

    const { getNovosERecorrentesClientes } = await import("../clientes");
    const result = await getNovosERecorrentesClientes(baseFilters);

    expect(result).toEqual({ novos: 1, recorrentes: 0 });
  });

  it("primeira compra ANTERIOR ao período + nova compra dentro dele → recorrente", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Bruno Costa" }]);
    queryRaw
      .mockResolvedValueOnce([{ norm: "BRUNO COSTA", first: new Date("2026-01-10") }])
      .mockResolvedValueOnce([]);

    const { getNovosERecorrentesClientes } = await import("../clientes");
    const result = await getNovosERecorrentesClientes(baseFilters);

    expect(result).toEqual({ novos: 0, recorrentes: 1 });
  });

  it("cliente com múltiplos pedidos no mesmo período é contado 1 vez só (groupBy já colapsa por cliente)", async () => {
    // groupBy({by:["clienteNome"]}) já devolve 1 linha por cliente, não 1 por venda —
    // simula isso diretamente (é o contrato real do Prisma pra essa consulta).
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Carla Dias" }]);
    queryRaw
      .mockResolvedValueOnce([{ norm: "CARLA DIAS", first: new Date("2026-10-05") }])
      .mockResolvedValueOnce([]);

    const { getNovosERecorrentesClientes } = await import("../clientes");
    const result = await getNovosERecorrentesClientes(baseFilters);

    expect(result.novos + result.recorrentes).toBe(1);
  });

  it("usa a data mais antiga entre Sale e ClienteCadastro.primeiraCompraExterna (histórico pré-DAPIC)", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Daniela Reis" }]);
    queryRaw
      .mockResolvedValueOnce([{ norm: "DANIELA REIS", first: new Date("2026-10-20") }]) // Sale mostra compra recente
      .mockResolvedValueOnce([{ norm: "DANIELA REIS", first: new Date("2022-05-01") }]); // mas ela já era cliente desde 2022 (site antigo)

    const { getNovosERecorrentesClientes } = await import("../clientes");
    const result = await getNovosERecorrentesClientes(baseFilters);

    // Primeira compra real é 2022 (antes do período) -> recorrente, não novo.
    expect(result).toEqual({ novos: 0, recorrentes: 1 });
  });

  it("cliente sem nenhuma primeira compra encontrada não quebra a reconciliação (é ignorado, não some do total de forma silenciosa e inesperada)", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Sem Historico" }]);
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const { getNovosERecorrentesClientes } = await import("../clientes");
    const result = await getNovosERecorrentesClientes(baseFilters);

    expect(result).toEqual({ novos: 0, recorrentes: 0 });
  });

  it("a consulta de 1ª compra exclui vendas canceladas (não deixa pedido cancelado virar a primeira compra)", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Eduardo Lima" }]);
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const { getNovosERecorrentesClientes } = await import("../clientes");
    await getNovosERecorrentesClientes(baseFilters);

    const sqlDaConsultaDeSale = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join("");
    expect(sqlDaConsultaDeSale).toContain("Cancelada");
  });

  it("respeita o filtro de loja (storeIds) na busca de 1ª compra quando informado", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Fabio Nunes" }]);
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const { getNovosERecorrentesClientes } = await import("../clientes");
    await getNovosERecorrentesClientes({ ...baseFilters, storeIds: ["store-leblon"] });

    const chamada = queryRaw.mock.calls[0];
    // Com storeIds informado, o valor é passado como parâmetro da query (confirma que o branch
    // "com storeIds" foi usado, não o branch global).
    expect(chamada.flat()).toEqual(expect.arrayContaining(["store-leblon"]));
  });
});
