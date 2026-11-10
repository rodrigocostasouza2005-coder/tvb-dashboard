import { describe, it, expect } from "vitest";
import {
  diagnosticarVariante,
  calcularOportunidadeTransferencia,
  agruparOportunidadesPorPar,
  type VariantePorLoja,
  type OportunidadeTransferencia,
} from "../distribuicao-estoque";

function oportunidade(overrides: Partial<OportunidadeTransferencia> = {}): OportunidadeTransferencia {
  return {
    cod: "COD-1",
    produto: "Classic Blue",
    grupo: "Camisetas",
    cor: "Azul",
    tamanho: "M",
    lojaOrigem: "Rio Sul",
    lojaDestino: "Leblon",
    estoqueOrigemAntes: 10,
    estoqueOrigemDepois: 5,
    estoqueDestinoAntes: 0,
    estoqueDestinoDepois: 5,
    coberturaOrigemAntes: 90,
    coberturaOrigemDepois: 45,
    coberturaDestinoAntes: 0,
    coberturaDestinoDepois: 30,
    quantidadeSugerida: 5,
    justificativa: [],
    ...overrides,
  };
}

function variante(overrides: Partial<VariantePorLoja> = {}): VariantePorLoja {
  const base: VariantePorLoja = {
    storeId: "store-leblon",
    storeCode: "LEBLON",
    storeName: "Leblon",
    estoqueAtual: 0,
    vendasDias30: 0,
    vendasDias60: 0,
    vendasDias90: 0,
    velocidadeDiaria: 0,
    coberturaDias: null,
    estoqueMinimo: null,
    diagnostico: "sem_dado",
    ...overrides,
  };
  return { ...base, diagnostico: diagnosticarVariante(base) };
}

describe("diagnosticarVariante", () => {
  it("sem estoque e sem venda em 90d -> sem_dado (não há o que analisar)", () => {
    expect(diagnosticarVariante({ estoqueAtual: 0, vendasDias30: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null })).toBe(
      "sem_dado"
    );
  });

  it("sem estoque mas com venda real em 90d -> ruptura (demanda não atendida)", () => {
    expect(diagnosticarVariante({ estoqueAtual: 0, vendasDias30: 0, vendasDias90: 5, velocidadeDiaria: 0, coberturaDias: null })).toBe(
      "ruptura"
    );
  });

  it("estoque positivo mas nenhuma venda em 90d -> estoque_parado", () => {
    expect(diagnosticarVariante({ estoqueAtual: 10, vendasDias30: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null })).toBe(
      "estoque_parado"
    );
  });

  it("cobertura abaixo de 7 dias -> cobertura_critica", () => {
    expect(
      diagnosticarVariante({ estoqueAtual: 3, vendasDias30: 30, vendasDias90: 90, velocidadeDiaria: 1, coberturaDias: 3 })
    ).toBe("cobertura_critica");
  });

  it("cobertura acima de 60 dias -> cobertura_excessiva", () => {
    expect(
      diagnosticarVariante({ estoqueAtual: 100, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 0.33, coberturaDias: 300 })
    ).toBe("cobertura_excessiva");
  });

  it("cobertura entre 7 e 60 dias -> equilibrado", () => {
    expect(
      diagnosticarVariante({ estoqueAtual: 20, vendasDias30: 20, vendasDias90: 60, velocidadeDiaria: 0.67, coberturaDias: 30 })
    ).toBe("equilibrado");
  });
});

describe("calcularOportunidadeTransferencia", () => {
  const contextoBase = {
    cod: "COD-1",
    produto: "Classic Blue",
    grupo: "Camisetas",
    cor: "Azul",
    tamanho: "M",
    coberturaAlvoDias: 30,
  };

  it("exemplo do pedido: origem com sobra parada + destino com demanda real -> sugere transferência", () => {
    const rioSul = variante({
      storeId: "rio-sul",
      storeCode: "RIOSUL",
      storeName: "Rio Sul",
      estoqueAtual: 12,
      vendasDias30: 0,
      vendasDias60: 0,
      vendasDias90: 0,
      velocidadeDiaria: 0,
    });
    const leblon = variante({
      storeId: "leblon",
      storeCode: "LEBLON",
      storeName: "Leblon",
      estoqueAtual: 2,
      vendasDias30: 15,
      vendasDias60: 28,
      vendasDias90: 40,
      velocidadeDiaria: 15 / 30,
      coberturaDias: 2 / (15 / 30),
    });
    const resultado = calcularOportunidadeTransferencia([rioSul, leblon], contextoBase);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].lojaOrigem).toBe("Rio Sul");
    expect(resultado[0].lojaDestino).toBe("Leblon");
    expect(resultado[0].quantidadeSugerida).toBeGreaterThan(0);
    expect(resultado[0].estoqueOrigemDepois).toBeLessThan(resultado[0].estoqueOrigemAntes);
    expect(resultado[0].estoqueDestinoDepois).toBeGreaterThan(resultado[0].estoqueDestinoAntes);
  });

  it("origem no próprio mínimo (sem sobra real) -> nenhuma sugestão", () => {
    const origemNoMinimo = variante({
      storeId: "rio-sul",
      storeName: "Rio Sul",
      estoqueAtual: 10,
      estoqueMinimo: 10,
      vendasDias30: 0,
      vendasDias90: 0,
    });
    const destinoCritico = variante({
      storeId: "leblon",
      storeName: "Leblon",
      estoqueAtual: 0,
      vendasDias30: 5,
      vendasDias90: 10,
      velocidadeDiaria: 5 / 30,
    });
    const resultado = calcularOportunidadeTransferencia([origemNoMinimo, destinoCritico], contextoBase);
    expect(resultado).toHaveLength(0);
  });

  it("distribuição equilibrada entre todas as lojas -> nenhuma sugestão", () => {
    const equilibrada = (storeId: string, storeName: string) =>
      variante({ storeId, storeName, estoqueAtual: 20, vendasDias30: 20, vendasDias90: 60, velocidadeDiaria: 20 / 30, coberturaDias: 30 });
    const resultado = calcularOportunidadeTransferencia(
      [equilibrada("leblon", "Leblon"), equilibrada("barra", "Barra"), equilibrada("rio-sul", "Rio Sul")],
      contextoBase
    );
    expect(resultado).toHaveLength(0);
  });

  it("uma origem com bastante sobra pode abastecer dois destinos diferentes", () => {
    const origemGrande = variante({
      storeId: "rio-sul",
      storeName: "Rio Sul",
      estoqueAtual: 100,
      vendasDias30: 0,
      vendasDias90: 0,
    });
    const destino1 = variante({
      storeId: "leblon",
      storeName: "Leblon",
      estoqueAtual: 0,
      vendasDias30: 10,
      vendasDias90: 20,
      velocidadeDiaria: 10 / 30,
    });
    const destino2 = variante({
      storeId: "barra",
      storeName: "Barra",
      estoqueAtual: 0,
      vendasDias30: 6,
      vendasDias90: 12,
      velocidadeDiaria: 6 / 30,
    });
    const resultado = calcularOportunidadeTransferencia([origemGrande, destino1, destino2], contextoBase);
    expect(resultado).toHaveLength(2);
    expect(new Set(resultado.map((r) => r.lojaOrigem))).toEqual(new Set(["Rio Sul"]));
    expect(new Set(resultado.map((r) => r.lojaDestino))).toEqual(new Set(["Leblon", "Barra"]));
  });

  it("nunca sugere origem == destino", () => {
    const unica = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 5, vendasDias90: 10, velocidadeDiaria: 5 / 30 });
    const resultado = calcularOportunidadeTransferencia([unica], contextoBase);
    expect(resultado).toHaveLength(0);
  });

  it("ruptura sem venda recente nenhuma (sem_dado) não é tratada como demanda -> nenhuma sugestão", () => {
    const semDado = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 0, vendasDias90: 0 });
    const origemParada = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 50, vendasDias30: 0, vendasDias90: 0 });
    const resultado = calcularOportunidadeTransferencia([semDado, origemParada], contextoBase);
    expect(resultado).toHaveLength(0);
  });
});

describe("agruparOportunidadesPorPar", () => {
  it("junta itens do mesmo par origem→destino num grupo só, somando a quantidade", () => {
    const itens = [
      oportunidade({ cod: "A", lojaOrigem: "Rio Sul", lojaDestino: "Leblon", quantidadeSugerida: 5 }),
      oportunidade({ cod: "B", lojaOrigem: "Rio Sul", lojaDestino: "Leblon", quantidadeSugerida: 3 }),
    ];
    const grupos = agruparOportunidadesPorPar(itens);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ lojaOrigem: "Rio Sul", lojaDestino: "Leblon", totalQuantidade: 8 });
    expect(grupos[0].itens.map((i) => i.cod)).toEqual(["A", "B"]);
  });

  it("nunca mistura pares diferentes, mesmo com as mesmas 2 lojas em sentido invertido", () => {
    const itens = [
      oportunidade({ cod: "A", lojaOrigem: "Rio Sul", lojaDestino: "Leblon", quantidadeSugerida: 5 }),
      oportunidade({ cod: "B", lojaOrigem: "Leblon", lojaDestino: "Rio Sul", quantidadeSugerida: 2 }),
    ];
    const grupos = agruparOportunidadesPorPar(itens);
    expect(grupos).toHaveLength(2);
    expect(grupos.find((g) => g.lojaOrigem === "Rio Sul")?.lojaDestino).toBe("Leblon");
    expect(grupos.find((g) => g.lojaOrigem === "Leblon")?.lojaDestino).toBe("Rio Sul");
  });

  it("ordena os grupos alfabeticamente por origem e depois por destino, não por tamanho do grupo", () => {
    const itens = [
      oportunidade({ cod: "A", lojaOrigem: "Rio Sul", lojaDestino: "Leblon", quantidadeSugerida: 100 }),
      oportunidade({ cod: "B", lojaOrigem: "Barra", lojaDestino: "Rio Sul", quantidadeSugerida: 1 }),
      oportunidade({ cod: "C", lojaOrigem: "Barra", lojaDestino: "Leblon", quantidadeSugerida: 1 }),
    ];
    const grupos = agruparOportunidadesPorPar(itens);
    expect(grupos.map((g) => `${g.lojaOrigem}->${g.lojaDestino}`)).toEqual([
      "Barra->Leblon",
      "Barra->Rio Sul",
      "Rio Sul->Leblon",
    ]);
  });

  it("lista vazia -> nenhum grupo", () => {
    expect(agruparOportunidadesPorPar([])).toEqual([]);
  });
});
