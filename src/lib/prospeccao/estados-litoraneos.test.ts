import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESTADOS_BRASIL, UFS_LITORANEAS, isUfLitoranea } from "./estados-litoraneos";

describe("mapa de prospecção do litoral", () => {
  it("inclui os 27 estados no desenho do Brasil", () => {
    expect(ESTADOS_BRASIL).toHaveLength(27);
    expect(new Set(ESTADOS_BRASIL.map((state) => state.uf)).size).toBe(27);
  });

  it("permite selecionar exatamente os 17 estados com litoral", () => {
    const states = ESTADOS_BRASIL.filter((state) => state.litoraneo).map((state) => state.uf);
    expect(states).toHaveLength(17);
    expect(states).toEqual(expect.arrayContaining(["AP", "PA", "MA", "PI", "CE", "RN", "PB", "PE", "AL", "SE", "BA", "ES", "RJ", "SP", "PR", "SC", "RS"]));
  });

  it("mantém geometria SVG em todos os estados", () => {
    expect(ESTADOS_BRASIL.every((state) => state.path.startsWith("m ") && state.path.length > 100)).toBe(true);
  });
});

describe("UFS_LITORANEAS / isUfLitoranea — fonte única de verdade da ingestão (Fase 2, unificação)", () => {
  it("tem exatamente os mesmos 17 códigos que ESTADOS_BRASIL.litoraneo", () => {
    const esperado = ESTADOS_BRASIL.filter((e) => e.litoraneo).map((e) => e.uf).sort();
    expect(UFS_LITORANEAS).toEqual(esperado);
    expect(UFS_LITORANEAS).toHaveLength(17);
  });

  // Teste de paridade entre os dois lados (TS/Python) sem duplicar a lista por digitação: o
  // Python (scripts/prospeccao/extrair-parquet-receita.py) e o workflow
  // (.github/workflows/agentes-prospeccao.yml) leem o MESMO arquivo JSON abaixo — isto aqui só
  // garante que o JSON corresponde exatamente ao que o TS deriva de ESTADOS_BRASIL. Se um dia o
  // JSON for editado sem atualizar ESTADOS_BRASIL (ou vice-versa), este teste falha imediatamente,
  // em vez de deixar os dois lados divergirem silenciosamente (achado B.3/E.7/D6 da auditoria).
  it("o JSON compartilhado com o lado Python/workflow bate exatamente com UFS_LITORANEAS", () => {
    const jsonPath = path.resolve(__dirname, "../../../scripts/prospeccao/estados-litoraneos.json");
    const doJson: string[] = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect([...doJson].sort()).toEqual([...UFS_LITORANEAS]);
  });

  it("aceita UF litorânea em qualquer caixa/espaço, rejeita não litorânea, ausente ou malformada", () => {
    expect(isUfLitoranea("RJ")).toBe(true);
    expect(isUfLitoranea("rj")).toBe(true);
    expect(isUfLitoranea("  SP ")).toBe(true);
    expect(isUfLitoranea("MG")).toBe(false); // estado real, só que não litorâneo
    expect(isUfLitoranea("DF")).toBe(false);
    expect(isUfLitoranea(null)).toBe(false);
    expect(isUfLitoranea(undefined)).toBe(false);
    expect(isUfLitoranea("")).toBe(false);
    expect(isUfLitoranea("R")).toBe(false);
    expect(isUfLitoranea("RJX")).toBe(false);
    expect(isUfLitoranea("12")).toBe(false);
  });
});
