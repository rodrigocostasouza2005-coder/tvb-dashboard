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

  // Correção (docs/planejamento-inteligente-estoque.md §16.2 item 2): getPesosCorTamanho
  // consultava Sale filtrando só por `produto` (nome), sem filtrar por cod classificado — a venda
  // de um cod irmão NÃO classificado (padrão comum: a maioria dos produtos Drop/Best Seller tem
  // só 1-2 de ~10 cods classificados) contaminava o peso usado pra repartir a compra sugerida
  // entre cor/tamanho. O mock abaixo simula o filtro real do banco: só devolve linhas cujo `cod`
  // está em `where.cod.in` — se o código de produção não passar `cods` pra getPesosCorTamanho (ou
  // não aplicar o filtro), o mock cai no fallback "sem filtro" (undefined) e devolve TODAS as
  // linhas, inclusive a do cod não classificado — fazendo este teste falhar.
  it("ignora venda de cod irmão NÃO classificado ao repartir a grade por cor (nunca contamina o peso)", async () => {
    getRecomendacoesBestSeller.mockResolvedValue([
      { produto: "Jaqueta Mista", grupo: "Jaquetas", cod: "AZ-P", quantidadeSugerida: 20, valorEstimado: null, confiavel: true, coberturaAtualDias: null, estoqueDisponivelUtilizavel: 0, demandaProjetadaHorizonte: 20, recebimentosUtilizaveis: 0, premissas: [], avisos: [] },
    ]);

    const RAW_SALES = [
      { cod: "AZ-P", cor: "Azul", tamanho: "P", quantidade: 50 }, // cod classificado (Best Seller)
      { cod: "VM-NAOCLASS", cor: "Vermelho", tamanho: "M", quantidade: 1000 }, // cod irmão NÃO classificado — venda bem maior, pra deixar óbvio se contaminar
    ];
    saleGroupBy.mockImplementation((args: { where?: { cod?: { in?: string[] } } }) => {
      const codsFiltro = args.where?.cod?.in;
      const linhas = codsFiltro ? RAW_SALES.filter((s) => codsFiltro.includes(s.cod)) : RAW_SALES;
      const porChave = new Map<string, number>();
      for (const s of linhas) {
        const chave = `${s.cor}|${s.tamanho}`;
        porChave.set(chave, (porChave.get(chave) ?? 0) + s.quantidade);
      }
      return Promise.resolve(
        [...porChave.entries()].map(([chave, quantidade]) => {
          const [cor, tamanho] = chave.split("|");
          return { cor, tamanho, _sum: { quantidade } };
        })
      );
    });

    const { getRecomendacaoGradeProduto } = await import("../planejamento-grade");
    const r = await getRecomendacaoGradeProduto("Jaqueta Mista");

    expect(r).not.toBeNull();
    expect(r!.cods).toEqual(["AZ-P"]); // só o cod classificado

    // Só a cor Azul (do cod classificado) deve aparecer — a venda do cod Vermelho (não
    // classificado) nunca deve entrar no peso, mesmo estando na mesma tabela de Sale.
    expect(r!.porCor).toHaveLength(1);
    expect(r!.porCor[0].cor).toBe("Azul");
    expect(r!.porCor[0].quantidadeSugerida).toBe(20); // 100% do total — não repartido com Vermelho
  });

  // Ajuste aditivo (pedido do Rodrigo, docs/planejamento-inteligente-estoque.md Parte 1 da rodada
  // de 2026-11-18): quantidadeSugeridaTotal<=0 é o caso mais comum em produção hoje (quase nenhum
  // cod classificado tem quantidadeSugerida > 0 — ver §10.7/§14.4) — mesmo assim, o Rodrigo quer
  // ver a proporção observada de venda real (vende mais em X, menos em Y) como fato descritivo,
  // nunca uma recomendação de compra fabricada. porCor continua [] (comportamento original
  // preservado), mas proporcaoObservada reflete o peso de venda real.
  it("quantidadeSugeridaTotal=0: porCor continua [] (nunca inventa recomendação), mas proporcaoObservada reflete a venda real por cor/tamanho", async () => {
    getRecomendacoesBestSeller.mockResolvedValue([
      {
        produto: "Bermuda Drop",
        grupo: "Bermudas",
        cod: "AZ-P",
        quantidadeSugerida: 0,
        valorEstimado: null,
        confiavel: true,
        coberturaAtualDias: 40,
        estoqueDisponivelUtilizavel: 0,
        demandaProjetadaHorizonte: 0,
        recebimentosUtilizaveis: 0,
        premissas: [],
        avisos: [],
      },
    ]);
    saleGroupBy.mockResolvedValue([
      { cor: "Azul", tamanho: "P", _sum: { quantidade: 30 } },
      { cor: "Azul", tamanho: "M", _sum: { quantidade: 10 } },
    ]);

    const { getRecomendacaoGradeProduto } = await import("../planejamento-grade");
    const r = await getRecomendacaoGradeProduto("Bermuda Drop");

    expect(r).not.toBeNull();
    expect(r!.quantidadeSugeridaTotal).toBe(0);
    expect(r!.porCor).toEqual([]); // nunca inventa quantidade a repartir

    expect(r!.proporcaoObservada).toHaveLength(1);
    const azul = r!.proporcaoObservada[0];
    expect(azul.cor).toBe("Azul");
    expect(azul.vendido).toBe(40);
    expect(azul.participacaoPct).toBe(100); // única cor com venda

    // Tamanho P vendeu o triplo de M (30 vs 10) — proporção fecha em 75%/25%, sem inventar peso
    // de núcleo (38/40/42/44), que só existe pra REPARTIR quantidade, não pra descrever fato.
    const tP = azul.porTamanho.find((t) => t.chave === "P")!;
    const tM = azul.porTamanho.find((t) => t.chave === "M")!;
    expect(tP.participacaoPct).toBe(75);
    expect(tM.participacaoPct).toBe(25);
  });

  it("sem nenhuma venda registrada: proporcaoObservada é [] (nunca inventa proporção sem dado)", async () => {
    getRecomendacoesBestSeller.mockResolvedValue([
      {
        produto: "Produto Sem Venda",
        grupo: "Grupo",
        cod: "PR-U",
        quantidadeSugerida: 0,
        valorEstimado: null,
        confiavel: true,
        coberturaAtualDias: null,
        estoqueDisponivelUtilizavel: 0,
        demandaProjetadaHorizonte: 0,
        recebimentosUtilizaveis: 0,
        premissas: [],
        avisos: [],
      },
    ]);
    saleGroupBy.mockResolvedValue([]);

    const { getRecomendacaoGradeProduto } = await import("../planejamento-grade");
    const r = await getRecomendacaoGradeProduto("Produto Sem Venda");

    expect(r!.porCor).toEqual([]);
    expect(r!.proporcaoObservada).toEqual([]);
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
