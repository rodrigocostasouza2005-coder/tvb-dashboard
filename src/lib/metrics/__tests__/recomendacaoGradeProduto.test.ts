import { describe, it, expect, vi, beforeEach } from "vitest";

const getRecomendacoesBestSeller = vi.fn();
const getRecomendacoesDrop = vi.fn();
const saleGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) } },
}));

vi.mock("../compras-inteligencia", () => ({
  getRecomendacoesBestSeller: (...a: unknown[]) => getRecomendacoesBestSeller(...a),
  getRecomendacoesDrop: (...a: unknown[]) => getRecomendacoesDrop(...a),
}));

beforeEach(() => {
  getRecomendacoesBestSeller.mockReset().mockResolvedValue([]);
  getRecomendacoesDrop.mockReset().mockResolvedValue([]);
  saleGroupBy.mockReset().mockResolvedValue([]);
});

describe("getRecomendacaoGradeProduto", () => {
  it("devolve null quando o produto não tem nenhuma recomendação (não classificado)", async () => {
    const { getRecomendacaoGradeProduto } = await import("../planejamento-grade");
    const r = await getRecomendacaoGradeProduto("Produto Qualquer");
    expect(r).toBeNull();
  });

  it("agrega quantidadeSugerida de múltiplos cods do mesmo produto e decompõe em grade que fecha com o total — cor+tamanho nunca se misturam", async () => {
    getRecomendacoesBestSeller.mockResolvedValue([
      { produto: "Camisa Polo", grupo: "Polos", cod: "AZ-P", quantidadeSugerida: 10, valorEstimado: 100, confiavel: true, coberturaAtualDias: 5, estoqueDisponivelUtilizavel: 0, demandaProjetadaHorizonte: 10, recebimentosUtilizaveis: 0, premissas: [], avisos: [] },
      { produto: "Camisa Polo", grupo: "Polos", cod: "VM-M", quantidadeSugerida: 20, valorEstimado: 200, confiavel: true, coberturaAtualDias: 3, estoqueDisponivelUtilizavel: 0, demandaProjetadaHorizonte: 20, recebimentosUtilizaveis: 0, premissas: [], avisos: [] },
    ]);
    // Venda real: Azul só vendeu tamanho P (peso 100%); Vermelho só vendeu tamanho M (peso 100%).
    // Se a decomposição misturasse cores, Azul ganharia participação de M (que não é dele) ou
    // vice-versa — o teste abaixo falharia se isso acontecesse.
    saleGroupBy.mockResolvedValue([
      { cor: "Azul", tamanho: "P", _sum: { quantidade: 50 } },
      { cor: "Vermelho", tamanho: "M", _sum: { quantidade: 30 } },
    ]);

    const { getRecomendacaoGradeProduto } = await import("../planejamento-grade");
    const r = await getRecomendacaoGradeProduto("Camisa Polo");

    expect(r).not.toBeNull();
    expect(r!.quantidadeSugeridaTotal).toBe(30); // 10 + 20, agregado de 2 cods
    expect(r!.cods).toEqual(expect.arrayContaining(["AZ-P", "VM-M"]));

    // Fecha: soma de todas as cores == total do produto
    const somaCores = r!.porCor.reduce((s, c) => s + c.quantidadeSugerida, 0);
    expect(somaCores).toBe(30);

    // Fecha: soma dos tamanhos de CADA cor == quantidade daquela cor
    for (const cor of r!.porCor) {
      const somaTamanhos = cor.porTamanho.reduce((s, t) => s + t.quantidadeSugerida, 0);
      expect(somaTamanhos).toBe(cor.quantidadeSugerida);
    }

    // Azul só tem o tamanho "P" na decomposição (nunca ganhou peso de "M", que é do Vermelho)
    const azul = r!.porCor.find((c) => c.cor === "Azul")!;
    expect(azul.porTamanho).toHaveLength(1);
    expect(azul.porTamanho[0].chave).toBe("P");

    const vermelho = r!.porCor.find((c) => c.cor === "Vermelho")!;
    expect(vermelho.porTamanho).toHaveLength(1);
    expect(vermelho.porTamanho[0].chave).toBe("M");
  });

  it("proporção entre cores respeita o peso de venda real de cada cor (dobro de venda -> dobro de quantidade)", async () => {
    getRecomendacoesBestSeller.mockResolvedValue([
      { produto: "Camisa Polo", grupo: "Polos", cod: "AZ-P", quantidadeSugerida: 30, valorEstimado: null, confiavel: true, coberturaAtualDias: null, estoqueDisponivelUtilizavel: 0, demandaProjetadaHorizonte: 30, recebimentosUtilizaveis: 0, premissas: [], avisos: [] },
    ]);
    saleGroupBy.mockResolvedValue([
      { cor: "Azul", tamanho: "P", _sum: { quantidade: 40 } }, // 2x o peso do Vermelho
      { cor: "Vermelho", tamanho: "P", _sum: { quantidade: 20 } },
    ]);

    const { getRecomendacaoGradeProduto } = await import("../planejamento-grade");
    const r = await getRecomendacaoGradeProduto("Camisa Polo");

    const azul = r!.porCor.find((c) => c.cor === "Azul")!;
    const vermelho = r!.porCor.find((c) => c.cor === "Vermelho")!;
    expect(azul.quantidadeSugerida).toBe(20); // 2/3 de 30
    expect(vermelho.quantidadeSugerida).toBe(10); // 1/3 de 30
    expect(azul.quantidadeSugerida + vermelho.quantidadeSugerida).toBe(30);
  });

  it("confiavel=false quando há recomendação de Drop junto (Drop não tem campo confiavel próprio, trata com cautela)", async () => {
    getRecomendacoesBestSeller.mockResolvedValue([]);
    getRecomendacoesDrop.mockResolvedValue([
      { produto: "Jaqueta Drop", grupo: "Jaquetas", cod: "PT-M", colecao: "Inverno26", quantidadeSugerida: 15, valorEstimado: null, diasRestantesJanela: 10, estoqueDisponivel: 0, sellThroughAtual: null, previsaoVendaAteFimJanela: 0, riscoSobra: false, excedenteEstimado: 0, riscoRuptura: true, faltanteEstimado: 15, bloqueadoRecompra: false, precisaConfirmacaoHumana: true, premissas: [], avisos: [] },
    ]);
    saleGroupBy.mockResolvedValue([{ cor: "Preto", tamanho: "M", _sum: { quantidade: 5 } }]);

    const { getRecomendacaoGradeProduto } = await import("../planejamento-grade");
    const r = await getRecomendacaoGradeProduto("Jaqueta Drop");

    expect(r!.confiavel).toBe(false);
    expect(r!.quantidadeSugeridaTotal).toBe(15);
  });
});
