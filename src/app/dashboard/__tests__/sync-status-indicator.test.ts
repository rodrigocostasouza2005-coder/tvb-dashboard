import { describe, it, expect } from "vitest";
import { formatIdade, formatDuracao, achatarFontes, piorStatus } from "../sync-status-indicator";
import type { SyncStatusDetalhado } from "@/lib/sync-runner";

// Resgate da feature "status detalhado no header" (worktree órfão agent-af55e6056fe53e292,
// auditoria 2026-11-14 — ficou >60 commits sem nunca abrir PR). O repo não tem ambiente de DOM
// configurado no vitest (environment: "node", sem jsdom/testing-library — ver vitest.config.ts e
// o restante da suíte, que só testa lógica de servidor) — então, seguindo o padrão já
// estabelecido, estes testes cobrem a LÓGICA pura exportada do componente (formatIdade,
// formatDuracao, achatarFontes, piorStatus), não a renderização do JSX em si.

describe("formatIdade", () => {
  const agora = new Date("2026-11-18T12:00:00.000Z");

  it("sem timestamp -> 'sem registro'", () => {
    expect(formatIdade(null, agora)).toBe("sem registro");
  });

  it("menos de 1 minuto -> 'agora'", () => {
    expect(formatIdade("2026-11-18T11:59:40.000Z", agora)).toBe("agora");
  });

  it("minutos -> 'há Xmin'", () => {
    expect(formatIdade("2026-11-18T11:45:00.000Z", agora)).toBe("há 15min");
  });

  it("horas -> 'há Xh'", () => {
    expect(formatIdade("2026-11-18T09:00:00.000Z", agora)).toBe("há 3h");
  });

  it("dias -> 'há Xd'", () => {
    expect(formatIdade("2026-11-15T12:00:00.000Z", agora)).toBe("há 3d");
  });

  it("timestamp no futuro (relógio local adiantado) -> 'agora', nunca minutos negativos", () => {
    expect(formatIdade("2026-11-18T12:05:00.000Z", agora)).toBe("agora");
  });
});

describe("formatDuracao", () => {
  it("null -> '—'", () => {
    expect(formatDuracao(null)).toBe("—");
  });

  it("negativo -> '—' (nunca duração negativa)", () => {
    expect(formatDuracao(-500)).toBe("—");
  });

  it("segundos -> 'Xs'", () => {
    expect(formatDuracao(45_000)).toBe("45s");
  });

  it("minutos exatos -> 'Xmin', sem '0s' sobrando", () => {
    expect(formatDuracao(120_000)).toBe("2min");
  });

  it("minutos com resto -> 'Xmin Ys'", () => {
    expect(formatDuracao(150_000)).toBe("2min 30s");
  });
});

function fonteDapic(source: string, overrides: Partial<SyncStatusDetalhado["dapic"][number]> = {}): SyncStatusDetalhado["dapic"][number] {
  return {
    source: source as SyncStatusDetalhado["dapic"][number]["source"],
    status: null,
    finishedAt: null,
    recordsSynced: null,
    message: null,
    ultimaAtualizacaoReal: null,
    duracaoMs: null,
    statusVisual: "sem_dados",
    ...overrides,
  };
}

function fonteExterna(source: "META_ADS" | "GA4", overrides: Partial<SyncStatusDetalhado["metaAds"]> = {}): SyncStatusDetalhado["metaAds"] {
  return {
    source,
    status: null,
    finishedAt: null,
    recordsSynced: null,
    message: null,
    ultimaAtualizacaoCache: null,
    ultimaAtualizacaoReal: null,
    duracaoMs: null,
    statusVisual: "sem_dados",
    ...overrides,
  };
}

function detalhadoBase(overrides: Partial<SyncStatusDetalhado> = {}): SyncStatusDetalhado {
  return {
    dapic: ["SALES", "STOCK", "RETURNS", "PRODUCTION", "GIFTS"].map((s) => fonteDapic(s)),
    locks: { sync: false, cancelamentos: false },
    metaAds: fonteExterna("META_ADS"),
    ga4: fonteExterna("GA4"),
    ...overrides,
  };
}

describe("achatarFontes", () => {
  it("detalhado null -> lista vazia (painel ainda não carregou nenhum poll)", () => {
    expect(achatarFontes(null)).toEqual([]);
  });

  it("achata as 5 fontes DAPIC + Meta Ads + GA4 numa lista única de 7", () => {
    const linhas = achatarFontes(detalhadoBase());
    expect(linhas).toHaveLength(7);
    expect(linhas.map((l) => l.source)).toEqual(["SALES", "STOCK", "RETURNS", "PRODUCTION", "GIFTS", "META_ADS", "GA4"]);
  });

  it("preserva statusVisual/ultimaAtualizacaoReal/duracaoMs/recordsSynced/message de cada fonte", () => {
    const detalhado = detalhadoBase({
      dapic: [fonteDapic("SALES", { statusVisual: "erro", message: "DAPIC 500", recordsSynced: 0, duracaoMs: 1200, ultimaAtualizacaoReal: "2026-11-18T10:00:00.000Z" })],
    });
    const [linha] = achatarFontes(detalhado);
    expect(linha).toEqual({
      source: "SALES",
      statusVisual: "erro",
      ultimaAtualizacaoReal: "2026-11-18T10:00:00.000Z",
      duracaoMs: 1200,
      recordsSynced: 0,
      message: "DAPIC 500",
    });
  });
});

describe("piorStatus", () => {
  it("lista vazia -> 'sem_dados'", () => {
    expect(piorStatus([])).toBe("sem_dados");
  });

  it("prioridade: executando > erro > atrasado > atualizado > sem_dados", () => {
    const linhas = achatarFontes(
      detalhadoBase({
        dapic: [
          fonteDapic("SALES", { statusVisual: "atualizado" }),
          fonteDapic("STOCK", { statusVisual: "atrasado" }),
          fonteDapic("RETURNS", { statusVisual: "erro" }),
          fonteDapic("PRODUCTION", { statusVisual: "executando" }),
          fonteDapic("GIFTS", { statusVisual: "sem_dados" }),
        ],
      })
    );
    expect(piorStatus(linhas)).toBe("executando");
  });

  it("sem_dados nunca é considerado 'pior' que atualizado — Meta Ads/GA4 sem registro ainda não deve pintar o badge de alerta", () => {
    const linhas = achatarFontes(
      detalhadoBase({
        dapic: ["SALES", "STOCK", "RETURNS", "PRODUCTION", "GIFTS"].map((s) => fonteDapic(s, { statusVisual: "atualizado" })),
        metaAds: fonteExterna("META_ADS", { statusVisual: "sem_dados" }),
        ga4: fonteExterna("GA4", { statusVisual: "sem_dados" }),
      })
    );
    expect(piorStatus(linhas)).toBe("atualizado");
  });

  it("erro isolado numa única fonte já é suficiente pra 'pior' ser 'erro', mesmo com as outras 6 atualizadas", () => {
    const linhas = achatarFontes(
      detalhadoBase({
        dapic: [
          fonteDapic("SALES", { statusVisual: "erro" }),
          ...["STOCK", "RETURNS", "PRODUCTION", "GIFTS"].map((s) => fonteDapic(s, { statusVisual: "atualizado" })),
        ],
        metaAds: fonteExterna("META_ADS", { statusVisual: "atualizado" }),
        ga4: fonteExterna("GA4", { statusVisual: "atualizado" }),
      })
    );
    expect(piorStatus(linhas)).toBe("erro");
  });
});
