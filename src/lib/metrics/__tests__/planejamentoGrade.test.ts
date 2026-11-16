import { describe, it, expect } from "vitest";
import { decomporProporcional } from "../planejamento-grade";

describe("decomporProporcional — função pura", () => {
  it("soma das partes bate exatamente com o total, mesmo quando a divisão não é exata (largest remainder)", () => {
    // 10 dividido proporcional a pesos 1/1/1 -> 3.33 cada, arredondamento ingênuo (floor) somaria
    // 9, não 10. O "resto" (1) precisa ir pro item com maior fração restante.
    const resultado = decomporProporcional(10, [
      { chave: "A", vendido: 1 },
      { chave: "B", vendido: 1 },
      { chave: "C", vendido: 1 },
    ]);
    const soma = resultado.reduce((s, r) => s + r.quantidadeSugerida, 0);
    expect(soma).toBe(10);
  });

  it("proporção respeita o peso real de venda — item que vendeu o dobro recebe o dobro", () => {
    const resultado = decomporProporcional(30, [
      { chave: "P", vendido: 20 },
      { chave: "M", vendido: 10 },
    ]);
    expect(resultado.find((r) => r.chave === "P")!.quantidadeSugerida).toBe(20);
    expect(resultado.find((r) => r.chave === "M")!.quantidadeSugerida).toBe(10);
    expect(resultado.every((r) => r.baseadoEmHistoricoReal)).toBe(true);
  });

  it("sem venda em NENHUM item, usa peso de fallback (nunca exclui item, só pesa diferente)", () => {
    const resultado = decomporProporcional(
      8,
      [
        { chave: "38", vendido: 0 },
        { chave: "36", vendido: 0 },
      ],
      (chave) => (chave === "38" ? 2 : 1)
    );
    expect(resultado).toHaveLength(2); // nenhum item excluído
    expect(resultado.every((r) => !r.baseadoEmHistoricoReal)).toBe(true);
    const peso38 = resultado.find((r) => r.chave === "38")!;
    const peso36 = resultado.find((r) => r.chave === "36")!;
    expect(peso38.quantidadeSugerida).toBeGreaterThan(peso36.quantidadeSugerida); // núcleo pesa mais
    expect(peso38.quantidadeSugerida + peso36.quantidadeSugerida).toBe(8); // mas soma continua exata
  });

  it("devolve [] quando quantidadeTotal <= 0 ou não há itens (nunca inventa distribuição)", () => {
    expect(decomporProporcional(0, [{ chave: "M", vendido: 5 }])).toEqual([]);
    expect(decomporProporcional(10, [])).toEqual([]);
  });

  it("fallback padrão (sem pesoFallback informado) trata todos os itens igual — não impõe núcleo de tamanho onde não se aplica (ex: decomposição por COR)", () => {
    const resultado = decomporProporcional(9, [
      { chave: "Azul", vendido: 0 },
      { chave: "Vermelho", vendido: 0 },
      { chave: "Verde", vendido: 0 },
    ]);
    expect(resultado.every((r) => r.quantidadeSugerida === 3)).toBe(true);
  });
});
