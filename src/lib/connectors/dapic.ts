// Conector para as APIs do DAPIC. Cada loja tem sua própria API/credencial,
// então cada uma ganha sua própria função de config aqui — não dá pra generalizar
// num loop único (ver [[project-tvb-dashboard]] no histórico do projeto).
//
// O formato de linha abaixo foi modelado a partir dos exports reais que a TVB já usava
// pro Power BI (mesmas colunas de VENDAS_PARA_BI.xlsx / ESTOQUE_POWER_BI.xlsx) — ajustar
// assim que tivermos a documentação real da API.

export type DapicSaleRow = {
  cod: string;
  produto: string;
  grupo: string;
  cor?: string;
  tamanho?: string;
  marca?: string;
  clienteNome?: string;
  vendedor?: string;
  tabelaPreco?: string;
  cidade?: string;
  estado?: string;
  quantidade: number;
  valorTotalLiquido: number;
  valorCustoTotal?: number;
  valorFrete?: number;
  saleDate: string; // ISO date
};

export type DapicStockRow = {
  cod: string;
  produto: string;
  grupo: string;
  cor?: string;
  tamanho?: string;
  colecao?: string;
  quantidadeDisponivel: number;
  estoqueMinimo?: number;
};

export type DapicStoreData = {
  sales: DapicSaleRow[];
  stock: DapicStockRow[];
};

type StoreConnectorConfig = {
  baseUrl: string | undefined;
  token: string | undefined;
};

const STORE_CONNECTORS: Record<string, StoreConnectorConfig> = {
  CD: {
    baseUrl: process.env.DAPIC_SITE_ATACADO_BASE_URL,
    token: process.env.DAPIC_SITE_ATACADO_TOKEN,
  },
  // Barra, Leblon, Rio Sul entram aqui quando tivermos a URL/token de cada uma.
};

export async function fetchStoreDataFromDapic(storeCode: string): Promise<DapicStoreData> {
  const config = STORE_CONNECTORS[storeCode];
  if (!config) {
    throw new Error(`Nenhum conector DAPIC configurado para a loja "${storeCode}".`);
  }
  if (!config.baseUrl || !config.token) {
    throw new Error(
      `Conector DAPIC da loja "${storeCode}" está sem BASE_URL ou TOKEN configurado no .env.local.`
    );
  }

  // TODO: ajustar os paths e o formato de resposta reais assim que tivermos
  // a documentação da API do DAPIC. Por enquanto isso é um placeholder.
  const response = await fetch(`${config.baseUrl}/vendas-estoque`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Erro ao consultar API do DAPIC (${storeCode}): ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}
