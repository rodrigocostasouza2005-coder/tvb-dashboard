// Conector real da API do DAPIC — descoberto direto da documentação (docs.dapic.app) em 2026-08-07.
//
// Confirmado em 2026-08-07: cada loja TEM sim seu próprio TokenIntegracao (a intuição original
// do Rodrigo estava certa) — mas a URL é a mesma pra todas (https://api.dapic.app/v1), só o
// token de login muda. Fluxo de autenticação, por token:
//   1. POST /autenticacao/v1/login com { Empresa, TokenIntegracao } -> devolve um access_token
//      (JWT) válido por 24h.
//   2. Esse access_token vai no header Authorization: Bearer <access_token> nas chamadas reais.
//   3. O que aquele token enxerga em GET /armazenadores é só a(s) loja(s) dele.
//
// Tokens confirmados (Empresa = "tvbshorts" pra todos):
//   - CD/Atacado: armazenadores CD(3), ATACADO(14), Defeito(4), Bonificação(10),
//     Marketing/Produção(13), Lixeira(15)
//   - Leblon: Leblon(6), Leblon - Defeitos(7)
//   - Rio Sul: Rio Sul(8), Rio Sul - Defeitos(9)
//   - Barra: Barra(16), Barra - Defeitos(17)
//
// Pendência: ainda não decidido se pedidosvendas ou vendaspdv é a fonte certa de vendas de loja
// física (pedidosvendas trouxe volume muito baixo no teste inicial).

const BASE_URL = process.env.DAPIC_BASE_URL ?? "https://api.dapic.app/v1";
const AUTH_URL = process.env.DAPIC_AUTH_URL ?? "https://api.dapic.app/autenticacao/v1/login";
const EMPRESA = process.env.DAPIC_EMPRESA;

export type DapicCredential = { label: string; tokenIntegracao: string };

// A API manda datas sem timezone (ex: "2026-08-10T12:58:07.582", sem "Z"/offset). `new Date()`
// sem timezone é interpretado como horário LOCAL DA MÁQUINA que roda o código — em produção
// (Vercel, UTC) isso por acaso dava o resultado certo, mas rodando local (Windows em horário de
// Brasília, UTC-3) deslocava a data em 3h. Confirmado real em 2026-08-11: causou duplicata de
// venda (mesmo pedido gravado 2x com saleDate 3h diferente, porque a ordem dos itens também não
// é garantida entre chamadas da API, então o item ganhou um itemIndex diferente na 2ª gravação e
// escapou da proteção de idempotência). Sempre ancorar em UTC explicitamente, não importa onde o
// código roda.
export function parseDapicDateTime(raw: string): Date {
  return new Date(raw.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
}

// DAPIC_CREDENTIALS: JSON tipo [{"label":"cd-atacado","tokenIntegracao":"..."}, ...]
// Mantém DAPIC_TOKEN_INTEGRACAO (um token só) funcionando como fallback pra não quebrar nada.
export function getCredentials(): DapicCredential[] {
  const raw = process.env.DAPIC_CREDENTIALS;
  if (raw) {
    try {
      return JSON.parse(raw) as DapicCredential[];
    } catch {
      throw new Error("DAPIC_CREDENTIALS não é um JSON válido.");
    }
  }
  if (process.env.DAPIC_TOKEN_INTEGRACAO) {
    return [{ label: "default", tokenIntegracao: process.env.DAPIC_TOKEN_INTEGRACAO }];
  }
  return [];
}

type LoginResponse = {
  access_token: string;
  expires_in: string;
  token_type: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type PaginatedResponse<T> = {
  Dados: T[];
  Pagina: number;
  RegistrosPorPagina: number;
  TotalPaginas: number;
};

export class DapicClient {
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(private tokenIntegracao: string, public label: string = "default") {}

  // Login tem rate limit próprio no DAPIC (5 requisições/60s no endpoint de autenticação,
  // achado em 2026-08-31 — os 4 tokens (leblon/rio-sul/barra/matriz) logando quase juntos numa
  // sync normal já chegam perto do limite). Diferente de .fetch() (que sempre tinha retry em
  // 429), login() falhava na hora — e como o retry de runSync() espera só 15s (bem menos que o
  // cooldown de 60s do DAPIC), uma 1ª falha de rate limit virava uma cadeia de falhas repetidas
  // em vez de se recuperar sozinha. Agora respeita o "DataLiberacao" que o DAPIC devolve no corpo
  // do erro 429 (quando vem) — espera até lá em vez de um backoff fixo.
  private async login(attempt = 1): Promise<string> {
    if (!EMPRESA) {
      throw new Error("DAPIC_EMPRESA não configurado no .env.local.");
    }

    const response = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Empresa: EMPRESA, TokenIntegracao: this.tokenIntegracao }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    if (response.status === 429 && attempt <= 4) {
      const body = await response.text().catch(() => "");
      const dataLiberacao = body.match(/"DataLiberacao":\s*"([^"]+)"/)?.[1];
      const retryAfterHeader = Number(response.headers.get("Retry-After"));
      const waitMs = dataLiberacao
        ? Math.max(1000, new Date(dataLiberacao).getTime() - Date.now() + 500)
        : Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : 15_000 * attempt;
      await sleep(Math.min(waitMs, 90_000));
      return this.login(attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`DAPIC login (${this.label}) falhou: ${response.status} ${response.statusText} ${body}`);
    }

    const data: LoginResponse = await response.json();
    const expiresInMs = Number(data.expires_in) * 1000;
    this.cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresInMs - 60_000,
    };
    return this.cachedToken.accessToken;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.accessToken;
    }
    return this.login();
  }

  private async fetch<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
    attempt = 1
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000), // nunca trava pra sempre num request pendurado
      });
    } catch (err) {
      if (attempt <= 5) {
        await sleep(1000 * 2 ** attempt);
        return this.fetch<T>(path, params, attempt + 1);
      }
      throw err;
    }

    if (response.status === 429 && attempt <= 5) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await sleep(waitMs);
      return this.fetch<T>(path, params, attempt + 1);
    }

    if (!response.ok) {
      throw new Error(`DAPIC ${path} (${this.label}) -> ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // 1000 por página (era 100) — testado em 2026-08-10: o estoque completo do CD/Atacado
  // (~14k linhas) foi de 144 páginas/253s pra ~15 páginas/132s, quase 2x mais rápido. A sync
  // estava tomando timeout (>300s) na Vercel com o valor antigo.
  private async fetchAllPages<T>(
    path: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T[]> {
    const all: T[] = [];
    let pagina = 1;
    for (;;) {
      const page = await this.fetch<PaginatedResponse<T>>(path, {
        ...params,
        Pagina: pagina,
        RegistrosPorPagina: 1000,
      });
      all.push(...page.Dados);
      if (pagina >= page.TotalPaginas) break;
      await sleep(150); // evita 429 (rate limit) em listas grandes e paginadas
      pagina++;
    }
    return all;
  }

  fetchArmazenadores() {
    return this.fetchAllPages<DapicArmazenador>("/armazenadores");
  }

  fetchEstoqueTodosArmazenadores() {
    return this.fetchAllPages<DapicArmazenadorProduto>("/armazenadores/produtos");
  }

  fetchPedidosVendas(dataInicial: string, dataFinal: string) {
    return this.fetchAllPages<DapicPedidoVendaResumo>("/pedidosvendas", {
      DataInicial: dataInicial,
      DataFinal: dataFinal,
    });
  }

  fetchPedidoVendaDetalhe(id: number) {
    return this.fetch<DapicPedidoVendaDetalhe>(`/pedidosvendas/${id}`);
  }

  // Descoberto em 2026-08-10 (token da Matriz) — o endpoint de LISTA (/ordensproducao) só traz
  // dado no nível da ordem (referência, quantidade total, sem produto/tamanho). Esse aqui
  // (/ordensproducao/produtos) é o que traz o detalhe por grade (IdGradeProduto = nosso cod).
  fetchOrdensProducaoProdutos(dataInicial: string, dataFinal: string) {
    return this.fetchAllPages<DapicOrdemProducaoProduto>("/ordensproducao/produtos", {
      DataInicial: dataInicial,
      DataFinal: dataFinal,
    });
  }

  // Vendas de ponto de venda (loja física) — confirmado em 2026-08-07 como a fonte de verdade
  // de vendas de loja (pedidosvendas trazia volume baixo demais, provavelmente é outro canal
  // tipo online/atacado). Já vem com Grupo/Marca/Coleção prontos por item.
  // EXCEÇÃO (achada em 2026-08-10, confirmada pelo Rodrigo): pro token cd-atacado, esse endpoint
  // só captura DEVOLUÇÃO de verdade — a VENDA de verdade do canal Site+Atacado vem de /faturas
  // (nota fiscal), não daqui. As linhas "Venda" que aparecem aqui pra esse token são só o lado
  // de troca (a devolução do item antigo tem uma linha "Venda" pareada, mas não é a venda real).
  fetchVendasPdv(dataInicial: string, dataFinal: string) {
    return this.fetchAllPages<DapicVendaPdv>("/vendaspdv", {
      DataInicial: dataInicial,
      DataFinal: dataFinal,
      FiltrarPor: "Fechamento",
    });
  }

  // Faturas (nota fiscal) — só o token cd-atacado tem acesso (as outras 3 lojas físicas retornam
  // vazio, tudo delas passa por vendaspdv mesmo). É a fonte de verdade de VENDA do canal Site +
  // Atacado (confirmado com Rodrigo em 2026-08-10) — vendaspdv desse token só tem devolução.
  fetchFaturas(dataInicial: string, dataFinal: string) {
    return this.fetchAllPages<DapicFatura>("/faturas", {
      DataInicial: dataInicial,
      DataFinal: dataFinal,
    });
  }

  // Detalhe por produto de uma fatura — não tem endpoint em lote, precisa 1 chamada por fatura
  // (por isso o backfill histórico é lento, ver scripts/backfill-faturas-site.ts).
  fetchFaturaProdutos(idFatura: number) {
    return this.fetchAllPages<DapicFaturaProduto>(`/faturas/${idFatura}/produtos`);
  }

  // Catálogo de tabelas de preço (ex: Varejo, Atacado) — nenhuma venda vem com esse campo
  // direto (nem /vendaspdv nem /faturas), só o endpoint abandonado /pedidosvendas tinha.
  // Achado em 2026-08-10, usado a partir de 2026-08-11 pra inferir qual tabela valeu numa venda
  // cruzando o preço unitário cobrado com o preço registrado aqui pro mesmo SKU.
  fetchTabelasPrecos() {
    return this.fetchAllPages<DapicTabelaPreco>("/tabelaprecos");
  }

  fetchTabelaPrecoProdutos(idTabela: number) {
    return this.fetchAllPages<DapicTabelaPrecoProduto>(`/tabelaprecos/${idTabela}/produtos`);
  }

  // Cadastro de clientes — 1 token basta (cd-atacado enxerga todos da empresa).
  // WhatsApp está sempre vazio nos dados da TVB (confirmado em amostra de 200 clientes em
  // 2026-08-14), então não guardamos. Telefone e Celular são campos distintos.
  fetchClientes(dataInicial: string, dataFinal: string) {
    return this.fetchAllPages<DapicCliente>("/clientes", {
      DataInicial: dataInicial,
      DataFinal: dataFinal,
    });
  }

  // Parcelas/contas a receber — usado para inadimplência. O filtro DataInicial/DataFinal
  // parece filtrar por DataEmissao, então para pegar todas as parcelas vencidas em aberto
  // basta usar um range amplo (ex: 2020-01-01 até hoje).
  fetchParcelas(dataInicial: string, dataFinal: string, status?: string) {
    return this.fetchAllPages<DapicParcela>("/contas/parcelas", {
      DataInicial: dataInicial,
      DataFinal: dataFinal,
      ...(status ? { Status: status } : {}),
    });
  }
}

export function createDapicClients(): DapicClient[] {
  return getCredentials().map((c) => new DapicClient(c.tokenIntegracao, c.label));
}

// O endpoint de estoque (/armazenadores/produtos) gruda a referência do produto no nome
// ("CSLBE - Classic Blue"), mas o endpoint de vendas (/vendaspdv) devolve o nome limpo
// ("Classic Blue") pro mesmo produto (mesmo IdGradeProduto/cod) — sem isso, Sellthrough e
// Pesquisa tratavam como dois produtos diferentes na hora de cruzar venda com estoque.
// Achado por Rodrigo em 2026-08-10.
export function stripReferenciaPrefix(produto: string): string {
  return produto.replace(/^\S+\s-\s/, "");
}

export type DapicArmazenador = {
  Id: number;
  Status: string;
  Descricao: string;
};

// ~14 mil linhas no total por token de loja única (CD/Atacado); cada token de loja física
// deve trazer bem menos (só a própria loja + o armazenador de defeitos dela).
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

export type DapicPedidoVendaResumo = {
  Id: number;
  Status: string;
  Codigo: string;
  DataEmissao: string;
  Cliente: string;
  ValorLiquido: number;
};

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

export type DapicVendaPdvProduto = {
  // Id da linha em si (não confundir com IdGradeProduto, o SKU) — único e estável por item,
  // ao contrário da posição no array Produtos[], que a API não garante manter entre chamadas
  // diferentes (achado em 2026-08-12: causou duplicata real quando o mesmo pedido foi buscado
  // 2x em janelas sobrepostas e a ordem dos itens mudou). Usar isso como chave de idempotência
  // em vez da posição.
  Id: number;
  IdGradeProduto?: number;
  Produto: string;
  Cor?: string;
  Tamanho?: string;
  // "Venda" | "Devolução" | "Brinde" — uma mesma venda de PV pode misturar os três.
  Tipo: string;
  Quantidade: number;
  Grupo: string | null;
  Marca: string | null;
  Colecao: string | null;
  ValorUnitario: number;
  ValorLiquido: number;
};

export type DapicVendaPdv = {
  Id: number;
  Status: string; // "Fechada" | "Cancelada" | "Aberto"
  Codigo: string;
  Cliente: string | null;
  Vendedor: string | null;
  DataFechamento: string | null;
  Cidade?: { Nome: string; Estado: string };
  Empresa: string;
  Produtos: DapicVendaPdvProduto[];
};

// Campos reais de /ordensproducao/produtos, confirmados em 2026-08-10 com o token da Matriz.
// "Id" NÃO é uma chave única por linha (várias linhas de tamanhos diferentes do mesmo produto
// numa mesma ordem repetem o mesmo Id) — usar (IdOrdemProducao, IdGradeProduto) como chave.
export type DapicOrdemProducaoProduto = {
  Id: number;
  IdOrdemProducao: number;
  IdGradeProduto: number;
  IdProduto: number;
  OrdemProducao: string;
  Referencia: string;
  Produto: string;
  Cor?: string;
  Tamanho?: string;
  Grupo: string | null;
  Marca: string | null;
  Colecao: string | null;
  QuantidadeOriginal: number;
  Quantidade: number;
  Status: string;
  DataFinalizacaoProducao: string | null;
  DataEntradaCelula: string | null;
};

// Campos reais de /clientes, confirmados em 2026-08-14. WhatsApp sempre nulo nos dados da TVB.
export type DapicCliente = {
  Id: number;
  NomeRazaoSocial: string;
  Telefone: string | null;
  Celular: string | null;
  WhatsApp: string | null;
  Email: string | null;
  // "YYYY-MM-DD" ou null — nem todo cliente tem, cadastro é opcional no PDV/site.
  DataAniversario: string | null;
  // CPF (pessoa física) ou CNPJ (pessoa jurídica), já formatado com pontuação. Descoberto em
  // 2026-08-28 — pedido do Rodrigo pra aparecer na Ficha do Cliente.
  CpfCnpj: string | null;
};

// Campos reais de /faturas, confirmados em 2026-08-10 com o token cd-atacado. Ao contrário de
// /vendaspdv, Cidade/Estado vêm como string solta (não objeto aninhado).
export type DapicFatura = {
  Status: string;
  Id: number;
  Codigo: string;
  CodigoExterno: string | null;
  DataCadastro: string;
  DataEmissao: string;
  DataFechamento: string | null;
  DataModificacao: string;
  IdCliente: number;
  Cliente: string;
  ClienteFantasia: string | null;
  ValorLiquido: number;
  Cidade: string | null;
  Estado: string | null;
  Empresa: string;
};

// Campos reais de /faturas/{id}/produtos, confirmados em 2026-08-10. Produto vem com a
// referência colada no nome igual /armazenadores/produtos ("CC353427 - Calça Confort Black") —
// precisa de stripReferenciaPrefix() igual o estoque.
export type DapicFaturaProduto = {
  IdProduto: number;
  Grupo: string | null;
  Marca: string | null;
  Colecao: string | null;
  Id: number;
  IdGradeProduto: number;
  Produto: string;
  Cor?: string;
  Tamanho?: string;
  Tipo: string;
  Quantidade: number;
  Valores: {
    ValorUnitario: number;
    ValorTotal: number;
    ValorDesconto: number;
    ValorAcrescimo: number;
    ValorFrete: number;
  };
};

// Campos reais confirmados em 2026-08-11 (tokens cd-atacado e leblon). 7 tabelas no total: Tabela
// varejo, Tabela atacado, Tabela Promocional, Promoção, Black Friday 2025, Transferência (65%),
// Custo — nem todo token vê todas (leblon viu só 5).
export type DapicTabelaPreco = {
  Id: number;
  Codigo: string;
  Descricao: string;
};

export type DapicTabelaPrecoProduto = {
  IdGradeProduto: number;
  Valor: number;
};

export type DapicParcela = {
  IdParcela: number;
  IdConta: number;
  Status: string;
  DataEmissao: string;
  DataVencimento: string;
  Conta: string;
  FormaPagamento: string;
  Pessoa: string;
  PlanoConta: string | null;
  Parcela: number;
  Valor: number;
  ValorPago: number;
  ValorAberto: number;
  ValorMulta: number;
  ValorJuros: number;
  Observacoes: string | null;
  NossoNumeroBoleto: string | null;
};
