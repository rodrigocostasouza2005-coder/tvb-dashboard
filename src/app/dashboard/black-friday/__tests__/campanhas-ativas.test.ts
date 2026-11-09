import { describe, it, expect } from "vitest";
import { mapInsights, statusAtivoIndisponivel } from "../campanhas-ativas";
import type { MetaInsight } from "@/lib/connectors/meta-ads";

function insight(gasto: number): MetaInsight {
  return {
    gasto,
    impressoes: 1000,
    alcance: 800,
    cliques: 50,
    ctrPct: 5,
    cpc: 1,
    cpm: 10,
    compras: 2,
    roas: 1.5,
    custoPorCompra: 50,
  };
}

// 2026-11-06, segunda rodada: Rodrigo testou o filtro "só ativos" (PR #58) e voltou atrás —
// "os criativos voltaram mas eu não consigo saber quais estão ativos ou não". Escolheu
// explicitamente: selo Ativo/Pausado de volta, mostrando TODOS (PR #56). A seleção de linhas
// (mapInsights) volta a ser pura por gasto, sem nenhuma participação de status ativo/pausado —
// status nunca mais tira ninguém da tabela, só vira selo (ver campanha-table.tsx).
describe("mapInsights — seleção de linhas é pura por gasto, status não participa do corte", () => {
  it("ordena por gasto desc e corta no limit, incluindo pausado (sem conceito de status aqui)", () => {
    const map = new Map<string, MetaInsight>([
      ["A - maior gasto", insight(100)],
      ["B - segundo gasto", insight(90)],
      ["C - terceiro gasto", insight(80)],
    ]);

    const resultado = mapInsights(map, 2);

    expect(resultado.map((r) => r.nome)).toEqual(["A - maior gasto", "B - segundo gasto"]);
  });

  it("um pausado que gastou mais continua no topo, igual um ativo — mapInsights não sabe de status", () => {
    // Antes do PR #58, essa era a regra: puro gasto. Depois de reverter o PR #58, é a regra de
    // novo. "Pausado"/"Ativo" não existe neste tipo (MetaInsight), só entra depois via
    // ativoPorNome em CampanhaTable — por isso esse teste nem usa a palavra "status".
    const map = new Map<string, MetaInsight>([
      ["Maior gasto", insight(500)],
      ["Segundo gasto", insight(10)],
    ]);

    const resultado = mapInsights(map, 1);

    expect(resultado.map((r) => r.nome)).toEqual(["Maior gasto"]);
  });

  it("remove gasto zero", () => {
    const map = new Map<string, MetaInsight>([
      ["Sem gasto", insight(0)],
      ["Com gasto", insight(10)],
    ]);

    const resultado = mapInsights(map, 15);

    expect(resultado.map((r) => r.nome)).toEqual(["Com gasto"]);
  });

  it("respeita o limit sobre o conjunto ordenado por gasto desc", () => {
    const map = new Map<string, MetaInsight>([
      ["1", insight(10)],
      ["2", insight(30)],
      ["3", insight(20)],
    ]);

    const resultado = mapInsights(map, 2);

    expect(resultado.map((r) => r.nome)).toEqual(["2", "3"]);
  });
});

describe("statusAtivoIndisponivel — quando avisar que o SELO ativo/pausado está indisponível", () => {
  const mapVazio = new Map<string, { ativos: number; total: number }>();

  it("mostra aviso quando o Meta Ads respondeu (sem erro geral) mas a busca de status pro conjunto falhou", () => {
    expect(statusAtivoIndisponivel(null, undefined, mapVazio)).toBe(true);
  });

  it("mostra aviso quando a busca de status pro anúncio falhou", () => {
    expect(statusAtivoIndisponivel(null, mapVazio, undefined)).toBe(true);
  });

  it("não mostra aviso quando as duas buscas de status resolveram normalmente", () => {
    expect(statusAtivoIndisponivel(null, mapVazio, mapVazio)).toBe(false);
  });

  it("não duplica aviso quando já existe erro geral do Meta Ads (mensagem mais grave já cobre o caso)", () => {
    expect(statusAtivoIndisponivel("token expirado", undefined, undefined)).toBe(false);
  });
});
