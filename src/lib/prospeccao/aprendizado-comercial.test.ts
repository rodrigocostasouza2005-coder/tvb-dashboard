import { describe, expect, it } from "vitest";
import { aprenderPerfis, pontuarAderenciaPerfil, type RegistroAprendizado } from "./aprendizado-comercial";

function lojas(n: number, resultado: RegistroAprendizado["resultado"] = "INTERESSADO", status = "CONTATADO"): RegistroAprendizado[] {
  return Array.from({ length: n }, (_, i) => ({
    prospectId: `p-${i}`, segmentoComercial: "MODA MASCULINA", perfilLoja: "MULTIMARCAS",
    faixaPreco: "MEDIO", estado: "RJ", status, resultado,
  }));
}

describe("aprendizado comercial do Radar", () => {
  it("não aprende com amostra menor que cinco lojas", () => {
    expect(aprenderPerfis(lojas(4))).toHaveLength(0);
  });

  it("exige ao menos três resultados com sinal e mede conversão DAPIC separadamente", () => {
    const base = lojas(5);
    base[0].status = "CONVERTIDO";
    base[1].resultado = "SEM_RESPOSTA";
    const perfil = aprenderPerfis(base)[0];
    expect(perfil.totalLojas).toBe(5);
    expect(perfil.convertidasDapic).toBe(1);
    expect(perfil.taxaConversaoDapic).toBe(20);
    expect(perfil.interacoesComSinal).toBe(4);
  });

  it("não conta várias interações da mesma loja como várias lojas", () => {
    const base = lojas(5);
    base.push({ ...base[0], resultado: "RECOMPRA" });
    expect(aprenderPerfis(base)[0].totalLojas).toBe(5);
  });

  it("não trata PEDIDO_REALIZADO informado pelo vendedor como conversão DAPIC", () => {
    const perfil = aprenderPerfis(lojas(5, "PEDIDO_REALIZADO"))[0];
    expect(perfil.sinaisPositivos).toBe(5);
    expect(perfil.convertidasDapic).toBe(0);
  });

  it("pontua candidatos que compartilham atributos de perfis promissores", () => {
    const perfil = aprenderPerfis(lojas(5))[0];
    const score = pontuarAderenciaPerfil({ segmentoComercial: "MODA MASCULINA", perfilLoja: "MULTIMARCAS", faixaPreco: "MEDIO", estado: "SP" }, [perfil]);
    expect(score.pontos).toBe(8);
    expect(score.correspondencias).toEqual(["segmento", "perfil de loja", "faixa de preço"]);
  });
});
