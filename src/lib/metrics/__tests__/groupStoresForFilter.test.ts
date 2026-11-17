import { describe, it, expect } from "vitest";
import { groupStoresForFilter } from "../core";

// Até 2026-11-16, CD e ATACADO (mesmo displayGroup "TVB Site e Atacado") apareciam como 1 opção
// só no filtro — groupStoresForFilter.test.ts antigo cobria exatamente isso. Revertido a pedido
// explícito do Rodrigo (2026-11-17): ele quer separar Site de Atacado no filtro, pra sempre saber
// qual dos dois está vendo (mesma motivação da Pesquisa, que também deixou de fundir os dois nas
// quebras "por loja" — ver estoque.ts/vendas.ts). displayGroup deixou de ter qualquer efeito no
// filtro — a função agora NUNCA agrupa, cada Store é sempre sua própria opção.
describe("groupStoresForFilter — cada Store é sempre sua própria opção (CD e ATACADO separados)", () => {
  it("CD e ATACADO (mesmo displayGroup, Store.code diferente) viram 2 opções distintas e selecionáveis", () => {
    const stores = [
      { id: "store-cd", name: "TVB Site e Atacado", code: "CD", displayGroup: "TVB Site e Atacado" },
      { id: "store-atacado", name: "ATACADO", code: "ATACADO", displayGroup: "TVB Site e Atacado" },
    ];
    const options = groupStoresForFilter(stores);

    expect(options).toHaveLength(2);
    expect(options.map((o) => o.id).sort()).toEqual(["store-atacado", "store-cd"]);
    // Nenhum id composto "id1|id2" — cada opção aponta pra um único storeId real.
    expect(options.every((o) => !o.id.includes("|"))).toBe(true);
  });

  it("rótulo do CD vira \"TVB Site\" (Store.name real é literalmente \"TVB Site e Atacado\", confuso agora que aparece separado)", () => {
    const stores = [{ id: "store-cd", name: "TVB Site e Atacado", code: "CD", displayGroup: "TVB Site e Atacado" }];
    const options = groupStoresForFilter(stores);

    expect(options[0].name).toBe("TVB Site");
  });

  it("ATACADO mantém o próprio nome, sem override", () => {
    const stores = [{ id: "store-atacado", name: "ATACADO", code: "ATACADO", displayGroup: "TVB Site e Atacado" }];
    const options = groupStoresForFilter(stores);

    expect(options[0].name).toBe("ATACADO");
  });

  it("loja física sem displayGroup (ex: Leblon) continua como opção própria, sem nenhum rótulo trocado", () => {
    const stores = [
      { id: "store-cd", name: "TVB Site e Atacado", code: "CD", displayGroup: "TVB Site e Atacado" },
      { id: "store-leblon", name: "Leblon", code: "LEBLON", displayGroup: null },
    ];
    const options = groupStoresForFilter(stores);

    const leblon = options.find((o) => o.id === "store-leblon");
    expect(leblon?.name).toBe("Leblon");
  });

  it("duas lojas físicas distintas sem displayGroup ficam cada uma na sua própria opção (comportamento que já existia, preservado)", () => {
    const stores = [
      { id: "store-leblon", name: "Leblon", code: "LEBLON", displayGroup: null },
      { id: "store-barra", name: "Barra", code: "BARRA", displayGroup: null },
    ];
    const options = groupStoresForFilter(stores);

    expect(options).toHaveLength(2);
    expect(options.map((o) => o.id).sort()).toEqual(["store-barra", "store-leblon"]);
  });
});
