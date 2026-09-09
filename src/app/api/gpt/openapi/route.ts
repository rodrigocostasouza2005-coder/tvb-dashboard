import { NextResponse } from "next/server";

// Especificação OpenAPI que o Rodrigo cola na tela de criação do Custom GPT (Actions) no
// ChatGPT — rota pública de propósito (o schema em si não é segredo, só as respostas exigem
// o Bearer token). Gerada à mão (não vale a pena um gerador automático pra 1 rota só).
const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "TVB Radar",
    description: "Consulta vendas, estoque e grade de tamanho da TVB Shorts.",
    version: "1.0.0",
  },
  servers: [{ url: "https://tvb-dashboard.vercel.app" }],
  paths: {
    "/api/gpt": {
      get: {
        operationId: "consultarRadar",
        summary: "Consulta vendas, estoque atual ou grade de tamanho de um produto",
        parameters: [
          {
            name: "resource",
            in: "query",
            required: true,
            description: "Qual dado consultar. Use 'lojas' primeiro pra ver os nomes válidos de loja.",
            schema: { type: "string", enum: ["vendas", "estoque", "grade", "lojas"] },
          },
          {
            name: "loja",
            in: "query",
            required: false,
            description: "Só pra 'vendas', 'estoque' e 'grade': nome da loja/filial pra filtrar (ex: 'Rio Sul', 'Barra', 'Leblon', 'Site e Atacado'). Use resource=lojas pra ver os nomes válidos. Padrão: todas as lojas.",
            schema: { type: "string" },
          },
          {
            name: "dimension",
            in: "query",
            required: false,
            description: "Como agrupar 'vendas' ou 'estoque'. Padrão: grupo.",
            schema: { type: "string", enum: ["grupo", "produto", "tamanho", "colecao"] },
          },
          {
            name: "canal",
            in: "query",
            required: false,
            description: "Só pra 'vendas': todos, b2b (atacado) ou b2c (varejo). Padrão: todos.",
            schema: { type: "string", enum: ["todos", "b2b", "b2c"] },
          },
          {
            name: "from",
            in: "query",
            required: false,
            description: "Só pra 'vendas': data inicial YYYY-MM-DD. Padrão: 30 dias atrás.",
            schema: { type: "string" },
          },
          {
            name: "to",
            in: "query",
            required: false,
            description: "Só pra 'vendas': data final YYYY-MM-DD. Padrão: hoje.",
            schema: { type: "string" },
          },
          {
            name: "produto",
            in: "query",
            required: false,
            description: "Só pra 'grade' (obrigatório): nome (ou parte do nome) do grupo ou produto, ex: 'Classic Lisa' ou 'Classic Blue'.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Resultado da consulta.",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": { description: "Token ausente ou inválido." },
          "400": { description: "Parâmetro inválido ou faltando." },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
  },
  security: [{ bearerAuth: [] }],
};

export async function GET() {
  return NextResponse.json(OPENAPI_SPEC);
}
