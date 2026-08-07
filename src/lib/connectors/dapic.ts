// Conector real da API do DAPIC — descoberto direto da documentação (docs.dapic.app) em 2026-08-07.
//
// NÃO é uma URL/token por loja. É uma API única (https://api.dapic.app/v1), com autenticação
// em duas etapas:
//   1. POST /autenticacao/v1/login com { Empresa, TokenIntegracao } -> devolve um access_token
//      (JWT) válido por 24h (expires_in em segundos).
//   2. Esse access_token vai no header Authorization: Bearer <access_token> nas chamadas reais.
// O TokenIntegracao (o que o Rodrigo passou primeiro) NÃO é usado direto como Bearer token —
// só serve pra trocar por um access_token na etapa 1.
//
// Testado de ponta a ponta em 2026-08-07 com sucesso (login + GET /armazenadores).
//
// Pendências conhecidas:
// - /armazenadores só retornou CD, ATACADO, Defeito, Bonificação, Marketing/Produção, Lixeira —
//   sem Barra/Leblon/Rio Sul. Ainda não sabemos como o estoque das lojas físicas é rastreado.
// - Formato de /armazenadores/{id}/produtos (estoque) ainda não confirmado com resposta real.
// - Ainda não decidido: usar /pedidosvendas ou /vendaspdv como fonte de vendas (talvez as duas).

const BASE_URL = process.env.DAPIC_BASE_URL ?? "https://api.dapic.app/v1";
const AUTH_URL = process.env.DAPIC_AUTH_URL ?? "https://api.dapic.app/autenticacao/v1/login";
const EMPRESA = process.env.DAPIC_EMPRESA;
const TOKEN_INTEGRACAO = process.env.DAPIC_TOKEN_INTEGRACAO;

type LoginResponse = {
  access_token: string;
  expires_in: string;
  token_type: string;
};

// Cache em memória do processo — suficiente pro tempo de vida de uma function serverless;
// se a instância for reciclada, só faz login de novo (é barato, uma request a mais).
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function login(): Promise<string> {
  if (!EMPRESA || !TOKEN_INTEGRACAO) {
    throw new Error("DAPIC_EMPRESA ou DAPIC_TOKEN_INTEGRACAO não configurados no .env.local.");
  }

  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Empresa: EMPRESA, TokenIntegracao: TOKEN_INTEGRACAO }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`DAPIC login falhou: ${response.status} ${response.statusText} ${body}`);
  }

  const data: LoginResponse = await response.json();
  const expiresInMs = Number(data.expires_in) * 1000;
  cachedToken = {
    accessToken: data.access_token,
    // Renova um pouco antes de expirar de verdade, com margem de segurança.
    expiresAt: Date.now() + expiresInMs - 60_000,
  };
  return cachedToken.accessToken;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  return login();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dapicFetch<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  attempt = 1
): Promise<T> {
  const accessToken = await getAccessToken();

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (response.status === 429 && attempt <= 5) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
    await sleep(waitMs);
    return dapicFetch<T>(path, params, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`DAPIC ${path} -> ${response.status} ${response.statusText}`);
  }

  return response.json();
}

type PaginatedResponse<T> = {
  Dados: T[];
  Pagina: number;
  RegistrosPorPagina: number;
  TotalPaginas: number;
};

async function fetchAllPages<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T[]> {
  const all: T[] = [];
  let pagina = 1;
  for (;;) {
    const page = await dapicFetch<PaginatedResponse<T>>(path, {
      ...params,
      Pagina: pagina,
      RegistrosPorPagina: 100,
    });
    all.push(...page.Dados);
    if (pagina >= page.TotalPaginas) break;
    await sleep(150); // evita 429 (rate limit) em listas grandes e paginadas
    pagina++;
  }
  return all;
}

export type DapicArmazenador = {
  Id: number;
  Status: string;
  Descricao: string;
};

export function fetchArmazenadores() {
  return fetchAllPages<DapicArmazenador>("/armazenadores");
}

// Estoque de todos os armazenadores de uma vez — confirmado com resposta real em 2026-08-07.
// ~14 mil linhas no total (1431 páginas de 10 no teste; usamos RegistrosPorPagina=100).
export type DapicArmazenadorProduto = {
  IdArmazenador: number;
  Armazenador: string;
  IdProduto: number;
  IdGradeProduto: number;
  Produto: string;
  Cor?: string;
  Tamanho?: string;
  Grupo: string | null;
  Marca: string | null;
  Colecao: string | null;
  Quantidade: number;
  QuantidadeReal: number;
  QuantidadeComprometida: number;
  Valor: number | null;
  ValorCusto: number | null;
};

export function fetchEstoqueTodosArmazenadores() {
  return fetchAllPages<DapicArmazenadorProduto>("/armazenadores/produtos");
}

export type DapicPedidoVendaResumo = {
  Id: number;
  Status: string;
  Codigo: string;
  DataEmissao: string;
  Cliente: string;
  ValorLiquido: number;
};

export function fetchPedidosVendas(dataInicial: string, dataFinal: string) {
  return fetchAllPages<DapicPedidoVendaResumo>("/pedidosvendas", {
    DataInicial: dataInicial,
    DataFinal: dataFinal,
  });
}

export type DapicPedidoVendaDetalhe = {
  Id: number;
  Codigo: string;
  DataEmissao: string;
  Cliente: { Id: number; Nome: string };
  Representante?: string;
  TabelaPrecos?: string;
  Produtos: {
    Produto: string;
    Cor?: string;
    Tamanho?: string;
    Quantidade: number;
    ValorUnitario: number;
    ValorTotal: number;
  }[];
  Valores: {
    ValorFrete: number;
    ValorTotal: number;
  };
};

export function fetchPedidoVendaDetalhe(id: number) {
  return dapicFetch<DapicPedidoVendaDetalhe>(`/pedidosvendas/${id}`);
}

export type DapicOrdemProducao = {
  Id: number;
  Grupo?: string;
  Produto: string;
  Tamanho?: string;
  QuantidadeFinalizada?: number;
  DataPrevisao?: string;
  OrdemProducao?: string;
};

export function fetchOrdensProducao(dataInicial: string, dataFinal: string) {
  return fetchAllPages<DapicOrdemProducao>("/ordensproducao", {
    DataInicial: dataInicial,
    DataFinal: dataFinal,
  });
}
