import { describe, it, expect } from "vitest";
import { montarVendasPorCanal, periodoAnterior } from "../black-friday";

const stores = [
  { id: "s-cd", code: "CD", name: "TVB Site e Atacado" },
  { id: "s-leblon", code: "Leblon", name: "Leblon" },
  { id: "s-riosul", code: "Rio Sul", name: "Rio Sul" },
  { id: "s-barra", code: "Barra", name: "Barra" },
  { id: "s-atacado", code: "ATACADO", name: "ATACADO" },
];

describe("montarVendasPorCanal", () => {
  it("nunca soma CD e ATACADO juntos, mesmo os dois usando displayGroup iguais na base", () => {
    const rows = montarVendasPorCanal(
      stores,
      [
        { storeId: "s-cd", units: 10, revenue: 1000 },
        { storeId: "s-atacado", units: 50, revenue: 5000 },
      ],
      [],
      new Map()
    );
    const cd = rows.find((r) => r.code === "CD");
    const atacado = rows.find((r) => r.code === "ATACADO");
    expect(cd?.revenue).toBe(1000);
    expect(atacado?.revenue).toBe(5000);
    // Cada canal aparece como linha própria — nunca uma linha só somando os dois.
    expect(rows).toHaveLength(5);
  });

  it("desconta devolução por loja (líquido), nunca bruto", () => {
    const rows = montarVendasPorCanal(
      stores,
      [{ storeId: "s-leblon", units: 20, revenue: 2000 }],
      [{ storeId: "s-leblon", units: 5, value: 500 }],
      new Map([["s-leblon", 4]])
    );
    const leblon = rows.find((r) => r.code === "Leblon");
    expect(leblon?.unitsSold).toBe(15);
    expect(leblon?.revenue).toBe(1500);
    expect(leblon?.ticketMedio).toBe(375);
  });

  it("loja sem nenhuma venda/devolução no período aparece com zero, não fica oculta", () => {
    const rows = montarVendasPorCanal(stores, [], [], new Map());
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.unitsSold).toBe(0);
      expect(r.revenue).toBe(0);
      expect(r.ticketMedio).toBeNull();
    }
  });

  it("segue a ordem fixa CD, Leblon, Rio Sul, Barra, ATACADO", () => {
    const rows = montarVendasPorCanal(stores, [], [], new Map());
    expect(rows.map((r) => r.code)).toEqual(["CD", "Leblon", "Rio Sul", "Barra", "ATACADO"]);
  });

  it("loja fora da ordem fixa (ex: armazém novo) aparece depois, nunca escondida", () => {
    const comNovaLoja = [...stores, { id: "s-novo", code: "Conserto", name: "Conserto" }];
    const rows = montarVendasPorCanal(comNovaLoja, [], [], new Map());
    expect(rows).toHaveLength(6);
    expect(rows[rows.length - 1].code).toBe("Conserto");
  });

  it("nome de exibição do CD vira 'Site (CD)', nunca o displayGroup agrupado", () => {
    const rows = montarVendasPorCanal(stores, [], [], new Map());
    const cd = rows.find((r) => r.code === "CD");
    expect(cd?.nome).toBe("Site (CD)");
  });
});

describe("periodoAnterior", () => {
  it("devolve uma janela anterior com a mesma duração, sem sobrepor o período atual", () => {
    const from = new Date("2026-11-20T00:00:00.000-03:00");
    const to = new Date("2026-11-26T23:59:59.999-03:00");
    const anterior = periodoAnterior(from, to);
    const duracaoAtual = to.getTime() - from.getTime();
    const duracaoAnterior = anterior.to.getTime() - anterior.from.getTime();
    expect(duracaoAnterior).toBe(duracaoAtual);
    expect(anterior.to.getTime()).toBeLessThan(from.getTime());
  });
});
