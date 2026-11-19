import { describe, it, expect, vi, beforeEach } from "vitest";

// Resgate da intenção de um teste órfão encontrado em
// .claude/worktrees/agent-aaa4f84bd99268592 (auditoria de 2026-11-14), que ficou sem commit
// num worktree baseado num commit de +60 PRs atrás (era da PR #48). Reescrito do zero aqui
// contra o dapic.ts ATUAL — não é cópia do arquivo antigo.
//
// Importante sobre escopo: as PRs #81/#82/#83 (auditoria de falsos sucessos, 2026-11-12/13)
// endureceram o tratamento de "resposta vazia tratada como sucesso silencioso" — mas essa lógica
// vive toda em src/lib/sync-runner.ts (syncEstoque/syncArmazenadores lançam erro se a lista vier
// vazia; doSync() distingue falha real de vazio legítimo pra PRODUCTION), já coberta por
// src/lib/__tests__/sync-runner.test.ts. DapicClient (este arquivo) nunca teve essa lógica e não
// deveria: fetchAllPages() é só o transporte HTTP/paginação — uma lista real vazia (ex: 0 ordens
// de produção no dia, legítimo) PRECISA continuar voltando `[]` sem lançar, é o chamador (camada
// de sync) que decide o que é suspeito pra cada endpoint. Por isso os testes abaixo cobrem o que
// de fato é responsabilidade do DapicClient: login/cache de token e paginação completa — e
// incluem explicitamente o caso "lista vazia não é erro aqui", pra deixar essa fronteira clara e
// não regredir.

// dapic.ts lê DAPIC_EMPRESA como `const` no top-level do módulo (uma vez só, na 1ª importação) —
// vitest não carrega .env/.env.local automaticamente pra process.env em testes puros de Node
// (sem Next.js por perto), então sem isso login() lançaria "DAPIC_EMPRESA não configurado" antes
// de qualquer mock de fetch rodar. `vi.hoisted` garante que isto roda ANTES do import de "../dapic"
// (imports estáticos são hoisted para o topo do módulo, então uma atribuição comum aqui no meio do
// arquivo rodaria tarde demais).
vi.hoisted(() => {
  process.env.DAPIC_EMPRESA = process.env.DAPIC_EMPRESA || "tvbshorts-teste";
});

// Mock mínimo do prisma: só dapicTokenCache, que é o único model que login()/getAccessToken()
// tocam neste arquivo.
const dapicTokenCacheFindUnique = vi.fn();
const dapicTokenCacheUpsert = vi.fn().mockResolvedValue({});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dapicTokenCache: {
      findUnique: (...a: unknown[]) => dapicTokenCacheFindUnique(...a),
      upsert: (...a: unknown[]) => dapicTokenCacheUpsert(...a),
    },
  },
}));

import { DapicClient } from "../dapic";

// Resposta de login fake — expires_in bem alto pra não precisar re-logar no meio do teste.
function loginResponse(accessToken = "tok-fake") {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({ access_token: accessToken, expires_in: "86400", token_type: "bearer" }),
    text: () => Promise.resolve(""),
  };
}

function paginatedResponse(dados: unknown[], pagina: number, totalPaginas: number) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({ Dados: dados, Pagina: pagina, RegistrosPorPagina: 1000, TotalPaginas: totalPaginas }),
    text: () => Promise.resolve(""),
  };
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    statusText: "Error",
    headers: { get: () => null },
    text: () => Promise.resolve(""),
  };
}

beforeEach(() => {
  dapicTokenCacheFindUnique.mockReset().mockResolvedValue(null);
  dapicTokenCacheUpsert.mockReset().mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn());
});

describe("login/cache de token", () => {
  it("sem cache (memória e DB vazios): loga de verdade e persiste o token no dapicTokenCache", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(loginResponse("tok-novo")).mockResolvedValueOnce(paginatedResponse([], 1, 1));

    const client = new DapicClient("tok-integracao", "teste");
    await client.fetchArmazenadores();

    // 1ª chamada é o POST de login (sempre antes de qualquer chamada real).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dapicTokenCacheUpsert).toHaveBeenCalledTimes(1);
    expect(dapicTokenCacheUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { label: "teste" },
        create: expect.objectContaining({ label: "teste", accessToken: "tok-novo" }),
        update: expect.objectContaining({ accessToken: "tok-novo" }),
      })
    );
  });

  it("token em memória ainda válido: a 2ª chamada pública não refaz login nem bate no DB", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(paginatedResponse([], 1, 1))
      .mockResolvedValueOnce(paginatedResponse([], 1, 1));

    const client = new DapicClient("tok-integracao", "teste");
    await client.fetchArmazenadores(); // loga + 1 página
    await client.fetchArmazenadores(); // reaproveita o token em memória

    expect(fetchMock).toHaveBeenCalledTimes(3); // login + página + página (nenhum 2º login)
    expect(dapicTokenCacheUpsert).toHaveBeenCalledTimes(1);
  });

  it("sem token em memória mas com um válido no DB (dapicTokenCache): usa o do DB, não loga de novo", async () => {
    dapicTokenCacheFindUnique.mockResolvedValue({
      accessToken: "tok-do-banco",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(paginatedResponse([{ Id: 1, Status: "Ativo", Descricao: "CD" }], 1, 1));

    const client = new DapicClient("tok-integracao", "teste");
    const resultado = await client.fetchArmazenadores();

    expect(resultado).toHaveLength(1);
    // Nenhuma chamada de POST de login — só a página de dados.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dapicTokenCacheUpsert).not.toHaveBeenCalled();
  });

  it("2 chamadas concorrentes sem token ainda: dedup — só 1 login real é disparado (loginPromise compartilhada)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(paginatedResponse([], 1, 1))
      .mockResolvedValueOnce(paginatedResponse([], 1, 1));

    const client = new DapicClient("tok-integracao", "teste");
    await Promise.all([client.fetchArmazenadores(), client.fetchTabelasPrecos()]);

    // 1 login + 2 páginas de dados = 3 chamadas; nunca 2 logins pro mesmo client em paralelo.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(dapicTokenCacheUpsert).toHaveBeenCalledTimes(1);
  });

  it("login falha (DAPIC fora do ar / credencial inválida): rejeita, nunca finge sucesso com token vazio", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(errorResponse(401));

    const client = new DapicClient("tok-invalido", "teste");
    await expect(client.fetchArmazenadores()).rejects.toThrow(/401/);
    expect(dapicTokenCacheUpsert).not.toHaveBeenCalled();
  });
});

describe("fetchAllPages (via fetchArmazenadores) — percorre todas as páginas sem corte prematuro", () => {
  it("3 páginas: acumula os Dados das 3 antes de devolver, não para na primeira", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(paginatedResponse([{ Id: 1, Status: "Ativo", Descricao: "CD" }], 1, 3))
      .mockResolvedValueOnce(paginatedResponse([{ Id: 2, Status: "Ativo", Descricao: "ATACADO" }], 2, 3))
      .mockResolvedValueOnce(paginatedResponse([{ Id: 3, Status: "Ativo", Descricao: "Leblon" }], 3, 3));

    const client = new DapicClient("tok", "teste");
    const resultado = await client.fetchArmazenadores();

    expect(resultado).toHaveLength(3);
    expect(resultado.map((r) => r.Id)).toEqual([1, 2, 3]);
    // login (1) + 3 páginas = 4 chamadas de fetch — nenhuma pulada, nenhuma repetida.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("1 página só (TotalPaginas=1): não faz uma 2ª chamada desnecessária", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(paginatedResponse([{ Id: 1, Status: "Ativo", Descricao: "CD" }], 1, 1));

    const client = new DapicClient("tok", "teste");
    const resultado = await client.fetchArmazenadores();

    expect(resultado).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lista vazia (TotalPaginas=1, Dados=[]) não lança e devolve array vazio — não é responsabilidade do DapicClient decidir se isso é suspeito (ver sync-runner.test.ts para a camada que decide)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(loginResponse()).mockResolvedValueOnce(paginatedResponse([], 1, 1));

    const client = new DapicClient("tok", "teste");
    const resultado = await client.fetchArmazenadores();

    expect(resultado).toEqual([]);
  });
});

describe("fetchAllPages — resposta parcial/erro no meio da lista (ex: falha na página 3 de 5)", () => {
  it("rejeita a promise inteira; NUNCA devolve as páginas já lidas como se fosse a lista completa", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(paginatedResponse([{ Id: 1, Status: "Ativo", Descricao: "p1" }], 1, 5))
      .mockResolvedValueOnce(paginatedResponse([{ Id: 2, Status: "Ativo", Descricao: "p2" }], 2, 5))
      // página 3 falha com 500 (não é 429, não entra no retry de rate-limit — erro definitivo)
      .mockResolvedValueOnce(errorResponse(500));

    const client = new DapicClient("tok", "teste");

    // fetchArmazenadores() (== fetchAllPages por baixo) tem que REJEITAR — o chamador
    // (syncArmazenadores em sync-runner.ts) nunca pode receber uma lista "de 2 páginas" fingindo
    // ser a lista completa de 5.
    await expect(client.fetchArmazenadores()).rejects.toThrow(/500/);

    // Nenhuma chamada da página 4/5 é feita — confirma que o loop parou no erro, não que
    // continuou e descartou o resultado depois.
    expect(fetchMock).toHaveBeenCalledTimes(4); // login + página 1 + página 2 + página 3 (que falhou)
  });

  it("confirma a implicação pro pipeline: como fetchAllPages só retorna DEPOIS de juntar todas as páginas, um erro no meio significa que a função de sync (syncVendas/syncEstoque/etc) nunca chega a montar os dados pra persistir — é tudo-ou-nada por endpoint, não um corte parcial silencioso", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(paginatedResponse([{ Id: 1, Status: "Ativo", Descricao: "p1" }], 1, 2))
      .mockResolvedValueOnce(errorResponse(500));

    const client = new DapicClient("tok", "teste");

    let dadosMontados: unknown[] | null = null;
    try {
      const linhas = await client.fetchArmazenadores();
      // Simula o que syncArmazenadores faria com o resultado — só é alcançado se fetchAllPages
      // tivesse devolvido parcial, o que NÃO deve acontecer.
      dadosMontados = linhas;
    } catch {
      // esperado
    }
    expect(dadosMontados).toBeNull();
  });
});
