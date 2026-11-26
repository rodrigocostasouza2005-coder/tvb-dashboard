import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// getHistoricoMovimentacoes trata erro Prisma P2021 (tabela não existe) / P2022 (coluna não
// existe) como "migration pendente" — mas isso só é verdade de fato quando o erro é da tabela
// conhecida (DecisaoMovimentacaoEstoque, migration 20261111160000_add_decisao_movimentacao_estoque,
// ainda não aplicada em produção por decisão deliberada). Incidente real (2026-11-25,
// ClassificacaoProduto.cod) mostrou a classe de bug: tratar QUALQUER P2021/P2022 como "migração
// pendente" sem checar qual tabela/coluna mascara erros reais completamente diferentes — e sem
// logar nada, o erro técnico (código, mensagem) vira invisível. Este teste trava os dois
// comportamentos: (1) só mascara pra tabela conhecida, (2) sempre loga antes de decidir.
const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    decisaoMovimentacaoEstoque: { findMany: (...a: unknown[]) => findManyMock(...a) },
  },
}));

function erroPrisma(code: "P2021" | "P2022", message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test" });
}

describe("getHistoricoMovimentacoes — não mascara P2021/P2022 fora da migration conhecida", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("devolve migrationPendente:true quando o erro é da tabela conhecida (DecisaoMovimentacaoEstoque) — e loga o erro técnico", async () => {
    findManyMock.mockRejectedValue(
      erroPrisma("P2021", "The table `public.DecisaoMovimentacaoEstoque` does not exist in the current database.")
    );
    const { getHistoricoMovimentacoes } = await import("../distribuicao-estoque");
    const r = await getHistoricoMovimentacoes();
    expect(r).toEqual({ migrationPendente: true, itens: [] });
    expect(console.error).toHaveBeenCalled();
  });

  it("NÃO mascara um P2021/P2022 em tabela/coluna DIFERENTE da conhecida — propaga como erro real (mas ainda loga)", async () => {
    findManyMock.mockRejectedValue(
      erroPrisma("P2022", "The column `ClassificacaoProduto.cod` does not exist in the current database.")
    );
    const { getHistoricoMovimentacoes } = await import("../distribuicao-estoque");
    await expect(getHistoricoMovimentacoes()).rejects.toThrow(/ClassificacaoProduto/);
    expect(console.error).toHaveBeenCalled();
  });
});
