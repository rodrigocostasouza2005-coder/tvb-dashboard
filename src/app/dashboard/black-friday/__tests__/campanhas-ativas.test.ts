import { describe, it, expect } from "vitest";
import { campanhasAtivasPorGasto, statusAtivoIndisponivel } from "../campanhas-ativas";
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

describe("campanhasAtivasPorGasto — filtra por status ANTES de cortar pro top-N por gasto", () => {
  it("exclui um pausado que estava no top-N por gasto e dá vaga pro ativo que ficou de fora do corte bruto", () => {
    // 3 entradas, limit=2. Por gasto bruto o top-2 seria A (100) e B (90) — mas B está pausado.
    // O correto é A (ativo) + C (ativo, 80) — nunca B, mesmo B tendo gasto maior que C.
    const map = new Map<string, MetaInsight>([
      ["A - ativo top gasto", insight(100)],
      ["B - pausado top gasto", insight(90)],
      ["C - ativo gasto menor", insight(80)],
    ]);
    const ativoPorNome = new Map<string, boolean>([
      ["A - ativo top gasto", true],
      ["B - pausado top gasto", false],
      ["C - ativo gasto menor", true],
    ]);

    const resultado = campanhasAtivasPorGasto(map, ativoPorNome, 2);

    expect(resultado.map((r) => r.nome)).toEqual(["A - ativo top gasto", "C - ativo gasto menor"]);
  });

  it("um ativo fora do corte bruto top-N (ex.: #16 por gasto) aparece quando os de cima estão pausados", () => {
    // limit=1: por gasto bruto só apareceria o #1 (pausado). Com o filtro correto, o #2 (ativo)
    // é quem deve aparecer — nunca uma tabela vazia só porque o maior gasto está pausado.
    const map = new Map<string, MetaInsight>([
      ["Maior gasto, pausado", insight(500)],
      ["Segundo gasto, ativo", insight(10)],
    ]);
    const ativoPorNome = new Map<string, boolean>([
      ["Maior gasto, pausado", false],
      ["Segundo gasto, ativo", true],
    ]);

    const resultado = campanhasAtivasPorGasto(map, ativoPorNome, 1);

    expect(resultado.map((r) => r.nome)).toEqual(["Segundo gasto, ativo"]);
  });

  it("nome com gasto que não aparece no Map de status (ausência) é tratado como não-ativo, não incluído", () => {
    const map = new Map<string, MetaInsight>([["Órfão, sem status", insight(100)]]);
    const ativoPorNome = new Map<string, boolean>(); // nome nem presente

    const resultado = campanhasAtivasPorGasto(map, ativoPorNome, 15);

    expect(resultado).toEqual([]);
  });

  it("continua removendo gasto zero (regra antiga preservada)", () => {
    const map = new Map<string, MetaInsight>([
      ["Sem gasto", insight(0)],
      ["Com gasto", insight(10)],
    ]);
    const ativoPorNome = new Map<string, boolean>([
      ["Sem gasto", true],
      ["Com gasto", true],
    ]);

    const resultado = campanhasAtivasPorGasto(map, ativoPorNome, 15);

    expect(resultado.map((r) => r.nome)).toEqual(["Com gasto"]);
  });

  it("fail-open: ativoPorNome undefined (status indisponível) não filtra nada, mantém o top-N por gasto normal, inclusive pausado", () => {
    const map = new Map<string, MetaInsight>([
      ["Ativo", insight(100)],
      ["Pausado, mas status indisponível agora", insight(90)],
    ]);

    const resultado = campanhasAtivasPorGasto(map, undefined, 2);

    expect(resultado.map((r) => r.nome)).toEqual(["Ativo", "Pausado, mas status indisponível agora"]);
  });

  it("respeita o limit sobre o conjunto já filtrado (ordenado por gasto desc)", () => {
    const map = new Map<string, MetaInsight>([
      ["1", insight(10)],
      ["2", insight(30)],
      ["3", insight(20)],
    ]);
    const ativoPorNome = new Map<string, boolean>([
      ["1", true],
      ["2", true],
      ["3", true],
    ]);

    const resultado = campanhasAtivasPorGasto(map, ativoPorNome, 2);

    expect(resultado.map((r) => r.nome)).toEqual(["2", "3"]);
  });
});

describe("statusAtivoIndisponivel — quando mostrar o aviso de fail-open acima das tabelas", () => {
  const mapVazio = new Map<string, boolean>();

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
