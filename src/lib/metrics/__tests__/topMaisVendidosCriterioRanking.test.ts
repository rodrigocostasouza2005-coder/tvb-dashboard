import { describe, it, expect } from "vitest";
import { sortTopVendidosPorCriterio } from "../core";

// Bug real (auditoria Pesquisa/Marketing, 2026-11-26): top-mais-vendidos/page.tsx sempre ordenava
// o ranking por receita (b.revenue - a.revenue), mesmo quando o rótulo da tela dizia "Top 10
// produtos por unidades líquidas" (showFinancials=false). Contas sem canSeeFinancials (lojas
// físicas: leblon@, barra@, riosul@, atendimento@) viam um Top 10 que, na prática, continuava
// ordenado por receita — um produto caro de baixo volume podia ocupar a vaga de um produto
// barato de alto volume. Corrigido extraindo o critério pra sortTopVendidosPorCriterio: ordena
// por unitsSold quando porReceita=false, por revenue quando porReceita=true.
describe("sortTopVendidosPorCriterio — Top Mais Vendidos respeita o rótulo exibido", () => {
  const rows = [
    // Produto caro, poucas unidades: alta receita, baixo volume.
    { key: "A", unitsSold: 5, revenue: 5000 },
    // Produto barato, muitas unidades: baixa receita, alto volume.
    { key: "B", unitsSold: 500, revenue: 4000 },
    { key: "C", unitsSold: 50, revenue: 1000 },
  ];

  it("sem canSeeFinancials (porReceita=false) ordena por unidades líquidas, não por receita", () => {
    const result = sortTopVendidosPorCriterio(rows, false);

    // Por unidades: B (500) > C (50) > A (5). SEM a correção (sempre ordenando por receita),
    // a ordem seria A (5000) > B (4000) > C (1000) — essa asserção falha no código antigo e
    // passa no novo.
    expect(result.map((r) => r.key)).toEqual(["B", "C", "A"]);
  });

  it("com canSeeFinancials (porReceita=true) continua ordenando por receita líquida (sem regressão)", () => {
    const result = sortTopVendidosPorCriterio(rows, true);

    expect(result.map((r) => r.key)).toEqual(["A", "B", "C"]);
  });

  it("não modifica o array original (cópia defensiva)", () => {
    const original = [...rows];
    sortTopVendidosPorCriterio(rows, false);
    expect(rows).toEqual(original);
  });
});
