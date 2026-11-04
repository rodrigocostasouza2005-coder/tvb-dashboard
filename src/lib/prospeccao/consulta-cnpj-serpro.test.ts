import { describe, expect, it, vi } from "vitest";
import { criarClienteSerpro, mapearConsultaSerpro, resumirSituacaoCnpj } from "./consulta-cnpj-serpro";

describe("consulta CNPJ Serpro", () => {
  it("maps official registration status, location, CNAE and contacts", () => {
    const record = mapearConsultaSerpro({
      ni: "34238864000168",
      nome_empresarial: "EMPRESA TESTE LTDA",
      nome_fantasia: "LOJA TESTE",
      situacao_cadastral: { codigo: "2", data: "2025-01-10" },
      cnae_principal: { codigo: "4781400", descricao: "Comércio varejista de artigos do vestuário" },
      cnae_secundarias: [{ codigo: "4781400", descricao: "Vestuário" }],
      endereco: { logradouro: "Rua A", numero: "10", bairro: "Centro", municipio: "Rio de Janeiro", uf: "rj", cep: "20000000" },
      telefones: [{ ddd: "21", numero: "999999999" }],
      correio_eletronico: "LOJA@EXEMPLO.COM",
    });
    expect(record.situacao).toBe("ATIVA");
    expect(record.cidade).toBe("Rio de Janeiro");
    expect(record.estado).toBe("RJ");
    expect(record.telefone).toBe("21999999999");
    expect(record.email).toBe("loja@exemplo.com");
    expect(record.cnaePrincipalCodigo).toBe("4781400");
    expect(record.cnaesSecundarios).toEqual(["4781400 - Vestuário"]);
    expect(record.situacaoCodigo).toBe("2");
  });

  it("does not guess unknown or absent registration status", () => {
    expect(resumirSituacaoCnpj(null)).toContain("não informada");
    expect(resumirSituacaoCnpj("8")).toContain("BAIXADA");
    expect(mapearConsultaSerpro({}).situacao).toBe("NAO_INFORMADA");
  });

  it("authenticates and queries the basic endpoint, caching token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-test", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ni: "34238864000168", situacao_cadastral: { codigo: "2" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ni: "34238864000168", situacao_cadastral: { codigo: "2" } }), { status: 200 }));
    const client = criarClienteSerpro({
      consumerKey: "key",
      consumerSecret: "secret",
      fetchImpl: fetchMock as typeof fetch,
    });
    await client.consultarBasica("34.238.864/0001-68");
    await client.consultarBasica("34238864000168");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/basica/34238864000168");
  });

  it("retries once after an expired bearer token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "old", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ni: "34238864000168", situacao_cadastral: { codigo: "2" } }), { status: 200 }));
    const client = criarClienteSerpro({ consumerKey: "key", consumerSecret: "secret", fetchImpl: fetchMock as typeof fetch });
    await client.consultarBasica("34238864000168");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
