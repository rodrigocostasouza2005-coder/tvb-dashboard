import { describe, it, expect } from "vitest";
import { TipoCompraProduto } from "@prisma/client";
import { particionarMatrizCompras } from "../matriz-helpers";
import type {
  MapaComprasGrupo,
  MesMapaCompras,
  RecomendacaoBestSellerPorProduto,
  RecomendacaoDropPorProduto,
  ClassificacaoPorProdutoEntry,
} from "@/lib/metrics";

// Achado 1 da auditoria pós-incidente de 2026-11-25: um produto Best Seller REAL (identificado por
// StockSnapshot.colecao === "BESTSELLER", mesma fonte que getRecomendacoesBestSeller já usa desde
// 2026-11-23 — refletida aqui em `bsPorCod`) mas SEM nenhuma linha manual em ClassificacaoProduto
// não aparecia em `classificacaoPorProduto` (que só cobre produtos classificados manualmente) — a
// matriz descartava o produto inteiro (`if (!classificacao) continue`), como se ele estivesse na
// fila de revisão, mesmo tendo uma recomendação de compra real calculada.

const TODOS_MESES = ["2026-01"];

function mes(over: Partial<MesMapaCompras> = {}): MesMapaCompras {
  return {
    mes: "2026-01",
    tipo: "realizado",
    estoqueInicial: 0,
    recebimento: 0,
    vendas: 0,
    bonificacoes: 0,
    estoqueFinal: 0,
    estoqueIdeal: 0,
    coberturaAtual: null,
    faltaComprar: 0,
    ...over,
  };
}

function grupo(produtos: { produto: string }[]): MapaComprasGrupo {
  return {
    grupo: "Grupo X",
    coberturaMeses: 2,
    meses: [mes()],
    produtos: produtos.map((p) => ({ produto: p.produto, meses: [mes()] })),
  };
}

function bsRow(over: Partial<RecomendacaoBestSellerPorProduto>): RecomendacaoBestSellerPorProduto {
  return {
    cod: "COD-1",
    grupo: "Grupo X",
    produto: "Produto Best Seller Real",
    estoqueDisponivelUtilizavel: 10,
    demandaProjetadaHorizonte: 50,
    coberturaAtualDias: 5,
    recebimentosUtilizaveis: 0,
    quantidadeSugerida: 40,
    valorEstimado: 400,
    confiavel: true,
    premissas: [],
    avisos: [],
    ...over,
  };
}

describe("particionarMatrizCompras — identidade Best Seller via colecao (achado 1)", () => {
  it("produto SEM classificação manual mas presente em bsPorCod (colecao=BESTSELLER) aparece no bloco Best Seller, não é descartado", () => {
    const g = grupo([{ produto: "Produto Best Seller Real" }]);
    const classificacaoPorProduto = new Map<string, ClassificacaoPorProdutoEntry>(); // vazio — nenhuma linha manual
    const bsPorCod = new Map<string, RecomendacaoBestSellerPorProduto>([
      ["COD-1", bsRow({ cod: "COD-1", produto: "Produto Best Seller Real", grupo: "Grupo X" })],
    ]);
    const dropPorCod = new Map<string, RecomendacaoDropPorProduto>();

    const resultado = particionarMatrizCompras(g ? [g] : [], classificacaoPorProduto, bsPorCod, dropPorCod, TODOS_MESES);

    expect(resultado).toHaveLength(1);
    expect(resultado[0].bestSeller.produtos).toHaveLength(1);
    expect(resultado[0].bestSeller.produtos[0].produto).toBe("Produto Best Seller Real");
    expect(resultado[0].bestSeller.produtos[0].cods).toEqual(["COD-1"]);
    expect(resultado[0].bestSeller.produtos[0].recomendacao?.quantidadeSugerida).toBe(40);
    expect(resultado[0].drop.produtos).toHaveLength(0);
  });

  it("produto sem classificação manual E sem presença em bsPorCod/dropPorCod continua fora da matriz (fila de revisão, comportamento preservado)", () => {
    const g = grupo([{ produto: "Produto Desconhecido" }]);
    const resultado = particionarMatrizCompras([g], new Map(), new Map(), new Map(), TODOS_MESES);
    expect(resultado).toHaveLength(0);
  });

  it("classificação manual explícita continua tendo prioridade sobre bsPorCod quando ambas existem (nunca duplica o produto nos dois blocos)", () => {
    const g = grupo([{ produto: "Produto Classificado Drop" }]);
    const classificacaoPorProduto = new Map<string, ClassificacaoPorProdutoEntry>([
      ["Grupo X::Produto Classificado Drop", { tipoCompra: TipoCompraProduto.DROP, divergente: false, cods: ["COD-2"] }],
    ]);
    // Mesmo que o cod também apareça em bsPorCod (ex: colecao=BESTSELLER mas reclassificado
    // manualmente como DROP) — manual sempre vence, mesma regra de resolverTipoCompraEfetivo.
    const bsPorCod = new Map<string, RecomendacaoBestSellerPorProduto>([
      ["COD-2", bsRow({ cod: "COD-2", produto: "Produto Classificado Drop", grupo: "Grupo X" })],
    ]);
    const dropPorCod = new Map<string, RecomendacaoDropPorProduto>();

    const resultado = particionarMatrizCompras([g], classificacaoPorProduto, bsPorCod, dropPorCod, TODOS_MESES);

    expect(resultado[0].bestSeller.produtos).toHaveLength(0);
    expect(resultado[0].drop.produtos).toHaveLength(1);
    expect(resultado[0].drop.produtos[0].produto).toBe("Produto Classificado Drop");
  });
});
