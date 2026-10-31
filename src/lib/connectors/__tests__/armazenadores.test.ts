import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { sellsProducts, verificarArmazemNovo } from "../armazenadores";

const armazemConhecidoCreate = vi.fn();
const armazemConhecidoFindUnique = vi.fn();
const armazemConhecidoUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    armazemConhecido: {
      create: (...a: unknown[]) => armazemConhecidoCreate(...a),
      findUnique: (...a: unknown[]) => armazemConhecidoFindUnique(...a),
      update: (...a: unknown[]) => armazemConhecidoUpdate(...a),
    },
  },
}));

describe("sellsProducts", () => {
  it("trata CD e ATACADO como loja de venda", () => {
    expect(sellsProducts("CD")).toBe(true);
    expect(sellsProducts("ATACADO")).toBe(true);
  });

  it("trata armazenadores de não-venda conhecidos como não-venda", () => {
    expect(sellsProducts("Defeito")).toBe(false);
    expect(sellsProducts("Lixeira (temporário)")).toBe(false);
    expect(sellsProducts("Bonificação")).toBe(false);
    expect(sellsProducts("Marketing/Produção")).toBe(false);
    expect(sellsProducts("Extraviado")).toBe(false);
  });

  it("trata Conserto como não-venda (achado 2026-10-27 — sem isso, roubava o primaryStoreId do CD)", () => {
    expect(sellsProducts("Conserto (enviados para conserto aguardando retor)")).toBe(false);
  });

  // Regressão do achado de 2026-10-30 (ver CODES_LOJAS_VAREJO em distribuicao-estoque.ts): esses
  // armazéns têm sellsProducts=true (não batem no regex NAO_VENDE) mas não são loja de varejo de
  // verdade — a proteção real contra "contaminar métricas de loja" é CODES_LOJAS_VAREJO ser uma
  // allowlist explícita (Leblon/Barra/Rio Sul), não decidir "é loja" só por sellsProducts=true.
  // Esse teste documenta que esses nomes PASSAM por sellsProducts (não é bug desta função), pra
  // deixar claro por que a allowlist explícita é necessária e não pode ser removida.
  it("'Uniformes'/'Produtos acabados'/'Matérias-primas' passam por sellsProducts (não são excluídos aqui de propósito — a proteção real é a allowlist de lojas de varejo)", () => {
    expect(sellsProducts("Uniformes")).toBe(true);
    expect(sellsProducts("Produtos acabados")).toBe(true);
    expect(sellsProducts("Matérias-primas")).toBe(true);
  });
});

describe("verificarArmazemNovo", () => {
  beforeEach(() => {
    armazemConhecidoCreate.mockReset();
    armazemConhecidoFindUnique.mockReset().mockResolvedValue(null);
    armazemConhecidoUpdate.mockReset().mockResolvedValue({});
  });

  function erroUnicidade() {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
  }

  it("1º encontro de um (token, Id DAPIC) -> ehNovo true", async () => {
    armazemConhecidoCreate.mockResolvedValue({});
    const r = await verificarArmazemNovo("cd-atacado", 20, "Conserto (enviados para fornecedor)", false);
    expect(r.ehNovo).toBe(true);
    expect(r.erro).toBeUndefined();
  });

  it("2º encontro do MESMO (token, Id) -> ehNovo false, sem alertar de novo", async () => {
    armazemConhecidoCreate.mockRejectedValue(erroUnicidade());
    armazemConhecidoFindUnique.mockResolvedValue({ nomeAtual: "Conserto (enviados para fornecedor)", classificacao: "NAO_VENDE" });
    const r = await verificarArmazemNovo("cd-atacado", 20, "Conserto (enviados para fornecedor)", false);
    expect(r.ehNovo).toBe(false);
    expect(r.erro).toBeUndefined();
  });

  it("mesmo Id com NOME diferente -> não é tratado como novo, só atualiza o nome informativo", async () => {
    armazemConhecidoCreate.mockRejectedValue(erroUnicidade());
    armazemConhecidoFindUnique.mockResolvedValue({ nomeAtual: "Conserto (a enviar ao fornecedor)", classificacao: "NAO_VENDE" });
    const r = await verificarArmazemNovo("cd-atacado", 20, "Conserto (enviados para fornecedor)", false);
    expect(r.ehNovo).toBe(false);
    expect(armazemConhecidoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nomeAtual: "Conserto (enviados para fornecedor)" }) })
    );
  });

  it("mesmo NOME com Id diferente -> tratado como armazém novo (a chave é o Id, nunca o nome)", async () => {
    armazemConhecidoCreate.mockResolvedValue({});
    const r = await verificarArmazemNovo("cd-atacado", 21, "Conserto (enviados para fornecedor)", false);
    expect(r.ehNovo).toBe(true);
  });

  it("mesmo Id em TOKENS diferentes não colide -> cada um é avaliado de forma independente", async () => {
    // create() real (Prisma) checaria a constraint composta (clientLabel, dapicArmazenadorId) —
    // aqui simulamos diretamente que os dois sucedem, pra provar que a função chama create() com
    // o clientLabel de cada um (e portanto não compartilha identidade entre tokens).
    armazemConhecidoCreate.mockResolvedValue({});
    const r1 = await verificarArmazemNovo("cd-atacado", 20, "Armazém X", false);
    const r2 = await verificarArmazemNovo("leblon", 20, "Armazém X", false);
    expect(r1.ehNovo).toBe(true);
    expect(r2.ehNovo).toBe(true);
    expect(armazemConhecidoCreate).toHaveBeenNthCalledWith(1, { data: { clientLabel: "cd-atacado", dapicArmazenadorId: 20, nomeAtual: "Armazém X", classificacao: "NAO_VENDE" } });
    expect(armazemConhecidoCreate).toHaveBeenNthCalledWith(2, { data: { clientLabel: "leblon", dapicArmazenadorId: 20, nomeAtual: "Armazém X", classificacao: "NAO_VENDE" } });
  });

  it("execuções concorrentes pro MESMO (token, Id) -> só uma conta como nova, a outra reconhece o conflito", async () => {
    // Simula a constraint real do Postgres: a 1ª chamada a "ganhar a corrida" sucede, a 2ª
    // (concorrente) recebe violação de unicidade — nenhuma lógica de lock manual no código, só a
    // garantia atômica do banco (ver comentário de verificarArmazemNovo).
    let criado = false;
    armazemConhecidoCreate.mockImplementation(async () => {
      if (criado) throw erroUnicidade();
      criado = true;
      return {};
    });
    armazemConhecidoFindUnique.mockResolvedValue({ nomeAtual: "Armazém Concorrente", classificacao: "NAO_VENDE" });

    const [r1, r2] = await Promise.all([
      verificarArmazemNovo("cd-atacado", 55, "Armazém Concorrente", false),
      verificarArmazemNovo("cd-atacado", 55, "Armazém Concorrente", false),
    ]);
    const novos = [r1, r2].filter((r) => r.ehNovo);
    expect(novos).toHaveLength(1);
  });

  it("mudança de classificação (vende <-> não vende) entre syncs é persistida", async () => {
    armazemConhecidoCreate.mockRejectedValue(erroUnicidade());
    armazemConhecidoFindUnique.mockResolvedValue({ nomeAtual: "Armazém Y", classificacao: "NAO_VENDE" });
    const r = await verificarArmazemNovo("leblon", 30, "Armazém Y", true); // agora sells=true
    expect(r.ehNovo).toBe(false);
    expect(armazemConhecidoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ classificacao: "VENDE" }) })
    );
  });

  it("falha de banco que NÃO é conflito de unicidade nunca é tratada como 'é novo' (evita alerta repetitivo sem controle)", async () => {
    armazemConhecidoCreate.mockRejectedValue(new Error("connection timeout"));
    const r = await verificarArmazemNovo("cd-atacado", 99, "Armazém Z", false);
    expect(r.ehNovo).toBe(false);
    expect(r.erro).toBeDefined();
  });
});
