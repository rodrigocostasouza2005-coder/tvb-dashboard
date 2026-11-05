import { describe, it, expect } from "vitest";
import { groupStoresForFilter } from "../core";

// Preparado pelo agente de QA da missão Black Friday (2026-11-05) — cobertura pedida: a
// separação Site(CD)/lojas físicas/Atacado tem que usar Store.code como identidade real, NUNCA
// displayGroup (que é só um rótulo de agrupamento de UI — ver comentário em schema.prisma e
// DISPLAY_GROUP em armazenadores.ts: CD e ATACADO compartilham o mesmo displayGroup "TVB Site e
// Atacado" só pra aparecer como 1 checkbox só no filtro, mas são duas Store.code DIFERENTES, com
// dado sempre gravado separado por baixo). groupStoresForFilter é o único lugar do projeto que lê
// displayGroup pra alguma coisa — qualquer métrica real não pode fazer o mesmo.
describe("groupStoresForFilter — agrupamento é só de APRESENTAÇÃO (ids continuam distintos por baixo)", () => {
  it("CD e ATACADO (mesmo displayGroup, Store.code diferente) viram 1 opção só no filtro, mas o id composto preserva os dois ids separados", () => {
    const stores = [
      { id: "store-cd", name: "CD", displayGroup: "TVB Site e Atacado" },
      { id: "store-atacado", name: "ATACADO", displayGroup: "TVB Site e Atacado" },
    ];
    const options = groupStoresForFilter(stores);

    expect(options).toHaveLength(1);
    // id composto "idCD|idAtacado" — parseFilters() expande de volta nos dois storeId reais na
    // hora de montar o where; nunca um id só "fundido" que impediria separar os dados depois.
    const ids = options[0].id.split("|");
    expect(ids).toEqual(expect.arrayContaining(["store-cd", "store-atacado"]));
    expect(ids).toHaveLength(2);
  });

  it("loja física sem displayGroup (ex: Leblon) nunca é agrupada com CD/ATACADO, mesmo soando parecido no nome", () => {
    const stores = [
      { id: "store-cd", name: "CD", displayGroup: "TVB Site e Atacado" },
      { id: "store-atacado", name: "ATACADO", displayGroup: "TVB Site e Atacado" },
      { id: "store-leblon", name: "Leblon", displayGroup: null },
    ];
    const options = groupStoresForFilter(stores);

    const standalone = options.find((o) => o.id === "store-leblon");
    expect(standalone).toBeDefined();
    expect(standalone?.name).toBe("Leblon");
    // Leblon nunca aparece dentro do id composto do grupo Site+Atacado.
    const grupoSiteAtacado = options.find((o) => o.id.includes("|"));
    expect(grupoSiteAtacado?.id).not.toContain("store-leblon");
  });

  it("duas lojas físicas distintas sem displayGroup ficam cada uma na sua própria opção (nunca agrupadas por engano)", () => {
    const stores = [
      { id: "store-leblon", name: "Leblon", displayGroup: null },
      { id: "store-barra", name: "Barra", displayGroup: null },
    ];
    const options = groupStoresForFilter(stores);

    expect(options).toHaveLength(2);
    expect(options.map((o) => o.id).sort()).toEqual(["store-barra", "store-leblon"]);
  });
});
