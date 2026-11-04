import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  findUnique: vi.fn(),
  activityCreate: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/api-token", () => ({ verifyApiToken: mocks.verifyApiToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    atacadoProspect: {
      findMany: mocks.findMany,
      groupBy: mocks.groupBy,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    atacadoProspectActivity: { create: mocks.activityCreate },
    $transaction: mocks.transaction,
  },
}));

import { GET, POST } from "./route";

function getRequest(resource = "fila", limit = "15", token = "valid-token") {
  return {
    headers: { get: (key: string) => key.toLowerCase() === "authorization" ? `Bearer ${token}` : null },
    nextUrl: { searchParams: new URLSearchParams({ resource, limit }) },
  } as unknown as NextRequest;
}

function postRequest(body: unknown, token = "valid-token") {
  return {
    headers: { get: (key: string) => key.toLowerCase() === "authorization" ? `Bearer ${token}` : null },
    json: async () => body,
  } as unknown as NextRequest;
}

describe("API de inteligência comercial do atacado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyApiToken.mockResolvedValue(true);
    mocks.findMany.mockResolvedValue([]);
    mocks.groupBy.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue({ id: "prospect-1", status: "QUALIFICADO" });
    mocks.activityCreate.mockReturnValue({ id: "activity-1" });
    mocks.update.mockReturnValue({ id: "prospect-1" });
    mocks.transaction.mockResolvedValue([]);
  });

  it("bloqueia consulta sem token válido", async () => {
    mocks.verifyApiToken.mockResolvedValue(false);
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("limita a fila do Bruce a no máximo 25 prospectos", async () => {
    const response = await GET(getRequest("fila", "500"));
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
  });

  it("só recomenda perfis com amostra mínima de três registros", async () => {
    mocks.groupBy.mockResolvedValue([
      { segmentoComercial: "MASCULINO", perfilLoja: "MULTIMARCAS", faixaPreco: "MEDIA", estado: "RJ", status: "CONVERTIDO", _count: { _all: 2 } },
      { segmentoComercial: "MASCULINO", perfilLoja: "MULTIMARCAS", faixaPreco: "MEDIA", estado: "RJ", status: "NEGOCIACAO", _count: { _all: 1 } },
      { segmentoComercial: "FEMININO", perfilLoja: "BOUTIQUE", faixaPreco: "ALTA", estado: "RJ", status: "CONVERTIDO", _count: { _all: 1 } },
    ]);
    const response = await GET(getRequest("inteligencia"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.recomendacoes).toHaveLength(1);
    expect(body.recomendacoes[0].total).toBe(3);
    expect(body.recomendacoes[0].taxaConversao).toBe(67);
  });

  it("impede Bruce de declarar conversão sem confirmação do primeiro pedido no DAPIC", async () => {
    const response = await POST(postRequest({
      prospectId: "prospect-1",
      descricao: "Cliente confirmou por mensagem que vai comprar",
      resultado: "PEDIDO_REALIZADO",
      status: "CONVERTIDO",
    }));
    expect(response.status).toBe(409);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("registra interação estruturada e atualiza status permitido", async () => {
    const response = await POST(postRequest({
      prospectId: "prospect-1",
      descricao: "Solicitou catálogo e tabela",
      resultado: "PEDIU_CATALOGO",
      canal: "WHATSAPP",
      status: "NEGOCIACAO",
      etapa: "CATALOGO_ENVIADO",
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("NEGOCIACAO");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.activityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resultado: "PEDIU_CATALOGO", canal: "WHATSAPP", criadoPor: "Bruce" }),
    }));
  });
});
