import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// registrarDecisaoMovimentacaoAction mostra "Histórico indisponível: migration
// DecisaoMovimentacaoEstoque ainda não foi aplicada" quando a gravação falha com P2021/P2022 —
// mas isso só deve ser verdade quando o erro é efetivamente da tabela conhecida
// (DecisaoMovimentacaoEstoque). O bug original (regex `does not exist|P2021|P2022` OR
// `DecisaoMovimentacaoEstoque`, sem exigir os dois juntos) mascarava QUALQUER erro Prisma desse
// tipo, de qualquer tabela/coluna, com a mesma mensagem enganosa "migration pendente" — e sem
// nenhum log do erro técnico real. Mesma classe do incidente real de 2026-11-25
// (ClassificacaoProduto.cod).
const sessionUser = { role: "GESTAO", email: "gestao@tvb.com" };

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => sessionUser),
}));

const registrarDecisaoMovimentacaoMock = vi.fn();
const atualizarStatusMovimentacaoMock = vi.fn();

vi.mock("@/lib/metrics", () => ({
  registrarDecisaoMovimentacao: (...a: unknown[]) => registrarDecisaoMovimentacaoMock(...a),
  atualizarStatusMovimentacao: (...a: unknown[]) => atualizarStatusMovimentacaoMock(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function erroPrisma(code: "P2021" | "P2022", message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test" });
}

const inputBase = {
  cod: "COD-1",
  produto: "Produto X",
  grupo: "Grupo X",
  origemPosicaoId: "o1",
  origemNome: "Origem",
  destinoPosicaoId: "d1",
  destinoNome: "Destino",
  tipoMovimentacao: "loja_loja" as const,
  classificacao: "REDISTRIBUIR" as const,
  quantidadeSugerida: 1,
  status: "PENDENTE" as const,
  confianca: "alta" as const,
  premissas: {},
};

describe("registrarDecisaoMovimentacaoAction — mensagem 'migration pendente' só pra tabela conhecida", () => {
  beforeEach(() => {
    registrarDecisaoMovimentacaoMock.mockReset();
    atualizarStatusMovimentacaoMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("mostra 'migration pendente' quando o erro é da tabela conhecida (DecisaoMovimentacaoEstoque) — e loga o erro técnico", async () => {
    registrarDecisaoMovimentacaoMock.mockRejectedValue(
      erroPrisma("P2021", "The table `public.DecisaoMovimentacaoEstoque` does not exist in the current database.")
    );
    const { registrarDecisaoMovimentacaoAction } = await import("../actions");
    const r = await registrarDecisaoMovimentacaoAction(inputBase);
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/migration DecisaoMovimentacaoEstoque/);
    expect(console.error).toHaveBeenCalled();
  });

  it("NÃO finge 'migration pendente' quando o P2021/P2022 é de OUTRA tabela — mensagem genérica, mas loga o erro técnico real", async () => {
    registrarDecisaoMovimentacaoMock.mockRejectedValue(
      erroPrisma("P2022", "The column `ClassificacaoProduto.cod` does not exist in the current database.")
    );
    const { registrarDecisaoMovimentacaoAction } = await import("../actions");
    const r = await registrarDecisaoMovimentacaoAction(inputBase);
    expect(r.ok).toBe(false);
    expect(r.mensagem).not.toMatch(/DecisaoMovimentacaoEstoque/);
    expect(console.error).toHaveBeenCalled();
  });
});
