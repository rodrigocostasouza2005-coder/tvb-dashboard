import { validarCnpj } from "./cnpj";

export type SerproCnpjResponse = {
  ni?: string;
  nome_empresarial?: string;
  nome_fantasia?: string;
  data_abertura?: string;
  situacao_cadastral?: { codigo?: string; data?: string; motivo?: string };
  cnae_principal?: { codigo?: string; descricao?: string };
  cnae_secundarias?: Array<{ codigo?: string; descricao?: string }>;
  endereco?: {
    logradouro?: string; numero?: string; complemento?: string; cep?: string;
    bairro?: string; municipio?: string | { codigo?: string; descricao?: string }; uf?: string;
  };
  correio_eletronico?: string;
  telefones?: Array<{ ddd?: string; numero?: string }>;
  porte?: string;
  capital_social?: number | string;
};

export type CnpjOfficialRecord = {
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacaoCodigo: string | null;
  situacao: string;
  situacaoData: string | null;
  motivo: string | null;
  cnaePrincipalCodigo: string | null;
  cnaePrincipalDescricao: string | null;
  cnaesSecundarios: string[];
  cidade: string | null;
  codigoMunicipio: string | null;
  estado: string | null;
  endereco: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  porte: string | null;
  dataAbertura: string | null;
};

const SITUACOES: Record<string, string> = {
  "1": "NULA",
  "2": "ATIVA",
  "3": "SUSPENSA",
  "4": "INAPTA",
  "8": "BAIXADA",
};

function clean(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

export function mapearConsultaSerpro(data: SerproCnpjResponse): CnpjOfficialRecord {
  const situacaoCodigo = clean(data.situacao_cadastral?.codigo);
  const municipio = data.endereco?.municipio;
  const cidade = typeof municipio === "string" ? clean(municipio) : clean(municipio?.descricao);
  const codigoMunicipio = typeof municipio === "object" && municipio ? clean(municipio.codigo) : null;
  const telefone = data.telefones?.[0];
  const telefoneCompleto = telefone ? [telefone.ddd, telefone.numero].map(clean).filter(Boolean).join("") : null;
  const endereco = [
    data.endereco?.logradouro,
    data.endereco?.numero,
    data.endereco?.complemento,
    data.endereco?.bairro,
  ].map(clean).filter(Boolean).join(", ") || null;

  return {
    cnpj: clean(data.ni) ?? "",
    razaoSocial: clean(data.nome_empresarial),
    nomeFantasia: clean(data.nome_fantasia),
    situacaoCodigo,
    situacao: situacaoCodigo ? (SITUACOES[situacaoCodigo] ?? "DESCONHECIDA") : "NAO_INFORMADA",
    situacaoData: clean(data.situacao_cadastral?.data),
    motivo: clean(data.situacao_cadastral?.motivo),
    cnaePrincipalCodigo: clean(data.cnae_principal?.codigo),
    cnaePrincipalDescricao: clean(data.cnae_principal?.descricao),
    cnaesSecundarios: (data.cnae_secundarias ?? []).map((item) => {
      const codigo = clean(item.codigo);
      const descricao = clean(item.descricao);
      return [codigo, descricao].filter(Boolean).join(" - ");
    }).filter(Boolean),
    cidade,
    codigoMunicipio,
    estado: clean(data.endereco?.uf)?.toUpperCase() ?? null,
    endereco,
    cep: clean(data.endereco?.cep),
    telefone: telefoneCompleto,
    email: clean(data.correio_eletronico)?.toLowerCase() ?? null,
    porte: clean(data.porte),
    dataAbertura: clean(data.data_abertura),
  };
}

type SerproConfig = {
  consumerKey: string;
  consumerSecret: string;
  apiBaseUrl?: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
};

export function criarClienteSerpro(config: SerproConfig) {
  const fetcher = config.fetchImpl ?? fetch;
  const apiBase = (config.apiBaseUrl ?? "https://gateway.apiserpro.serpro.gov.br/consulta-cnpj-df/v2").replace(/\/$/, "");
  const tokenUrl = config.tokenUrl ?? "https://gateway.apiserpro.serpro.gov.br/token";
  let token: string | null = null;
  let tokenExpiresAt = 0;

  async function obterToken(force = false): Promise<string> {
    if (!force && token && Date.now() < tokenExpiresAt - 30_000) return token;
    const basic = Buffer.from(config.consumerKey + ":" + config.consumerSecret).toString("base64");
    const response = await fetcher(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("SERPRO_TOKEN_HTTP_" + response.status);
    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("SERPRO_TOKEN_SEM_ACCESS_TOKEN");
    token = body.access_token;
    tokenExpiresAt = Date.now() + Math.max(60, Number(body.expires_in) || 3600) * 1000;
    return token;
  }

  async function consultarBasica(cnpj: string): Promise<CnpjOfficialRecord> {
    const normalized = validarCnpj(cnpj);
    if (!normalized) throw new Error("CNPJ_INVALIDO_OU_DIGITOS_VERIFICADORES_INCORRETOS");
    for (let attempt = 0; attempt < 2; attempt++) {
      const bearer = await obterToken(attempt === 1);
      const response = await fetcher(apiBase + "/basica/" + encodeURIComponent(normalized), {
        headers: { Accept: "application/json", Authorization: "Bearer " + bearer },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401 && attempt === 0) continue;
      if (response.status === 404) throw new Error("CNPJ_NAO_ENCONTRADO");
      if (!response.ok) throw new Error("SERPRO_CONSULTA_HTTP_" + response.status);
      const data = await response.json() as SerproCnpjResponse;
      const record = mapearConsultaSerpro(data);
      if (!record.cnpj) throw new Error("SERPRO_RESPOSTA_SEM_CNPJ");
      if (record.cnpj.toUpperCase() !== normalized) throw new Error("CNPJ_RETORNADO_DIVERGENTE");
      return { ...record, cnpj: normalized };
    }
    throw new Error("SERPRO_NAO_AUTORIZADO");
  }

  return { consultarBasica };
}

export function resumirSituacaoCnpj(codigo: string | null): string {
  if (!codigo) return "Situação cadastral não informada pela fonte.";
  const situacao = SITUACOES[codigo] ?? "DESCONHECIDA";
  return "Situação cadastral oficial: " + situacao + " (código " + codigo + ").";
}
