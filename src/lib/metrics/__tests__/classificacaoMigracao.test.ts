import { describe, it, expect } from "vitest";
import { agruparEResolverClassificacoes, resolverGrupoClassificacao, type LinhaClassificacaoAntiga } from "../classificacao-migracao";

function linha(overrides: Partial<LinhaClassificacaoAntiga> & { id: string; cod: string }): LinhaClassificacaoAntiga {
  return {
    produto: "Camisa Polo",
    grupo: "Polos",
    colecao: null,
    tipoCompra: "BEST_SELLER",
    statusComercial: "ATIVO",
    possibilidadeReposicao: "SIM",
    dataLancamento: null,
    dataEncerramentoPrevista: null,
    orcamentoDrop: null,
    observacoes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolverGrupoClassificacao", () => {
  it("sem divergência entre os cods do grupo -> conflita false, qualquer uma serve de vencedora", () => {
    const grupo = resolverGrupoClassificacao("Camisa Polo::Azul", [
      linha({ id: "a", cod: "COD-AZUL-P", updatedAt: "2026-01-01T00:00:00.000Z" }),
      linha({ id: "b", cod: "COD-AZUL-M", updatedAt: "2026-01-02T00:00:00.000Z" }),
    ]);
    expect(grupo.conflita).toBe(false);
    expect(grupo.camposDivergentes).toEqual([]);
    // mesmo sem conflito, a vencedora é sempre a mais recente (consistência do critério).
    expect(grupo.vencedora.id).toBe("b");
    expect(grupo.perdedoras.map((p) => p.id)).toEqual(["a"]);
  });

  it("tipoCompra divergente entre cods da MESMA cor -> conflito real, vence o updatedAt mais recente", () => {
    const grupo = resolverGrupoClassificacao("Camisa Polo::Azul", [
      linha({ id: "antigo", cod: "COD-AZUL-P", tipoCompra: "DROP", updatedAt: "2026-01-01T00:00:00.000Z" }),
      linha({ id: "recente", cod: "COD-AZUL-M", tipoCompra: "BEST_SELLER", updatedAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    expect(grupo.conflita).toBe(true);
    expect(grupo.camposDivergentes).toContain("tipoCompra");
    expect(grupo.vencedora.id).toBe("recente");
    expect(grupo.vencedora.tipoCompra).toBe("BEST_SELLER");
    expect(grupo.perdedoras.map((p) => p.id)).toEqual(["antigo"]);
  });

  it("múltiplos campos divergentes são todos reportados (statusComercial + orcamentoDrop)", () => {
    const grupo = resolverGrupoClassificacao("Vestido::Verde", [
      linha({ id: "a", cod: "COD-1", statusComercial: "ATIVO", orcamentoDrop: 1000, updatedAt: "2026-01-01T00:00:00.000Z" }),
      linha({ id: "b", cod: "COD-2", statusComercial: "EM_ENCERRAMENTO", orcamentoDrop: 2000, updatedAt: "2026-01-05T00:00:00.000Z" }),
    ]);
    expect(grupo.conflita).toBe(true);
    expect(grupo.camposDivergentes.sort()).toEqual(["orcamentoDrop", "statusComercial"].sort());
    expect(grupo.vencedora.id).toBe("b");
  });

  it("empate exato de updatedAt resolve por createdAt mais recente, depois por id (determinístico, nunca aleatório)", () => {
    const mesmoUpdated = "2026-01-01T00:00:00.000Z";
    const grupo1 = resolverGrupoClassificacao("X::Azul", [
      linha({ id: "z", cod: "COD-1", tipoCompra: "DROP", updatedAt: mesmoUpdated, createdAt: "2026-01-01T00:00:00.000Z" }),
      linha({ id: "a", cod: "COD-2", tipoCompra: "BEST_SELLER", updatedAt: mesmoUpdated, createdAt: "2025-01-01T00:00:00.000Z" }),
    ]);
    // createdAt mais recente ("z") vence mesmo tendo id "maior" alfabeticamente — createdAt tem prioridade sobre id.
    expect(grupo1.vencedora.id).toBe("z");

    const grupo2 = resolverGrupoClassificacao("X::Verde", [
      linha({ id: "b", cod: "COD-3", updatedAt: mesmoUpdated, createdAt: mesmoUpdated }),
      linha({ id: "a", cod: "COD-4", updatedAt: mesmoUpdated, createdAt: mesmoUpdated }),
    ]);
    // tudo empatado -> desempate final e determinístico por id (ordem alfabética).
    expect(grupo2.vencedora.id).toBe("a");
  });

  it("lança erro se chamado com grupo vazio (bug de quem chama, nunca deveria acontecer)", () => {
    expect(() => resolverGrupoClassificacao("X::Y", [])).toThrow();
  });
});

describe("agruparEResolverClassificacoes", () => {
  it("cores DIFERENTES do mesmo produto NUNCA são agrupadas juntas, mesmo com tipoCompra diferente — divergência legítima, não conflito", () => {
    const corPorCod = new Map([
      ["COD-AZUL-P", "Azul"],
      ["COD-AZUL-M", "Azul"],
      ["COD-VERDE-P", "Verde"],
    ]);
    const { grupos } = agruparEResolverClassificacoes(
      [
        linha({ id: "1", cod: "COD-AZUL-P", tipoCompra: "BEST_SELLER" }),
        linha({ id: "2", cod: "COD-AZUL-M", tipoCompra: "BEST_SELLER" }),
        linha({ id: "3", cod: "COD-VERDE-P", tipoCompra: "DROP" }),
      ],
      corPorCod
    );

    expect(grupos).toHaveLength(2);
    const azul = grupos.find((g) => g.produtoCor === "Camisa Polo::Azul")!;
    const verde = grupos.find((g) => g.produtoCor === "Camisa Polo::Verde")!;
    expect(azul.conflita).toBe(false);
    expect(azul.vencedora.tipoCompra).toBe("BEST_SELLER");
    expect(verde.conflita).toBe(false); // grupo de 1 linha só, nada pra divergir
    expect(verde.vencedora.tipoCompra).toBe("DROP");
  });

  it("cod sem cor resolvida (sem base real em Sale/StockSnapshot) fica fora de qualquer grupo, nunca adivinhado", () => {
    const corPorCod = new Map([["COD-1", "Azul"]]);
    const { grupos, semBaseReal } = agruparEResolverClassificacoes(
      [linha({ id: "1", cod: "COD-1" }), linha({ id: "2", cod: "COD-FANTASMA" })],
      corPorCod
    );
    expect(grupos).toHaveLength(1);
    expect(semBaseReal).toHaveLength(1);
    expect(semBaseReal[0].cod).toBe("COD-FANTASMA");
  });

  it("3 tamanhos da mesma cor, 2 classificações diferentes entre eles -> 1 grupo conflitante, vencedora = mais recente", () => {
    const corPorCod = new Map([
      ["COD-AZUL-P", "Azul"],
      ["COD-AZUL-M", "Azul"],
      ["COD-AZUL-G", "Azul"],
    ]);
    const { grupos } = agruparEResolverClassificacoes(
      [
        linha({ id: "p", cod: "COD-AZUL-P", tipoCompra: "DROP", updatedAt: "2026-01-01T00:00:00.000Z" }),
        linha({ id: "m", cod: "COD-AZUL-M", tipoCompra: "DROP", updatedAt: "2026-01-01T00:00:00.000Z" }),
        linha({ id: "g", cod: "COD-AZUL-G", tipoCompra: "BEST_SELLER", updatedAt: "2026-03-01T00:00:00.000Z" }),
      ],
      corPorCod
    );
    expect(grupos).toHaveLength(1);
    const grupo = grupos[0];
    expect(grupo.conflita).toBe(true);
    expect(grupo.linhas).toHaveLength(3);
    expect(grupo.vencedora.id).toBe("g");
    expect(grupo.vencedora.tipoCompra).toBe("BEST_SELLER");
    expect(grupo.perdedoras.map((p) => p.id).sort()).toEqual(["m", "p"]);
  });
});
