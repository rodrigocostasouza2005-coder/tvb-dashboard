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
            description:
              "Qual dado consultar. Use 'lojas' primeiro pra ver os nomes válidos de loja. Use 'vendas_por_loja' quando o pedido for comparar/listar todas as lojas de uma vez (resource=vendas com 'loja' só filtra 1 loja por chamada, não quebra). Use 'devolucoes' pra cruzar com 'vendas' e chegar na receita líquida de devolução.",
            schema: { type: "string", enum: ["vendas", "vendas_por_loja", "devolucoes", "estoque", "grade", "lojas"] },
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
            description: "Como agrupar 'vendas', 'vendas_por_loja' (opcional — sem isso é só o total por loja), 'devolucoes' ou 'estoque'. Padrão: grupo (obrigatório em 'devolucoes').",
            schema: { type: "string", enum: ["grupo", "produto", "tamanho", "colecao"] },
          },
          {
            name: "canal",
            in: "query",
            required: false,
            description: "Só pra 'vendas' e 'vendas_por_loja': todos, b2b (atacado) ou b2c (varejo). Padrão: todos.",
            schema: { type: "string", enum: ["todos", "b2b", "b2c"] },
          },
          {
            name: "from",
            in: "query",
            required: false,
            description: "Data inicial YYYY-MM-DD (vendas, vendas_por_loja, devolucoes). Padrão: 30 dias atrás.",
            schema: { type: "string" },
          },
          {
            name: "to",
            in: "query",
            required: false,
            description: "Data final YYYY-MM-DD (vendas, vendas_por_loja, devolucoes). Padrão: hoje.",
            schema: { type: "string" },
          },
          {
            name: "produto",
            in: "query",
            required: false,
            description: "Só pra 'grade' (obrigatório): nome (ou parte do nome) do grupo ou produto, ex: 'Classic Lisa' ou 'Classic Blue'. Quanto mais completo o texto, melhor o match.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description:
              "Resultado da consulta. Em 'vendas'/'vendas_por_loja', 'revenue'/'receita' é líquida de desconto e frete mas NÃO de devolução nem taxa de cartão — cruze com 'devolucoes' pra descontar. Em 'estoque'/'grade', o campo 'atualizadoEm' informa a hora da última sync bem-sucedida (roda ~5x/dia, não é tempo real). Em 'grade', 'pctQuebrada' é a % de tamanhos zerados daquele produto naquela loja e 'gradeQuebrada' é true a partir de 40%.",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": { description: "Token ausente ou inválido." },
          "400": { description: "Parâmetro inválido ou faltando (loja/produto não encontrado devolve a lista de valores válidos)." },
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
