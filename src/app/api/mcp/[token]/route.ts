import type { NextRequest } from "next/server";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { verifyApiToken } from "@/lib/api-token";
import { getSalesByDimension, getEstoqueAtual, getGradeTamanhoBusca } from "@/lib/metrics";
import { brasiliaDayStart, brasiliaDayEnd, todayBrasiliaStr } from "@/lib/filters";

// Conector MCP pra ligar o Radar no Claude (Conectores personalizados, Configurações →
// Conectores) — pedido do Rodrigo em 2026-09-08, equivalente do Custom GPT do ChatGPT
// (/api/gpt), mesmas 3 consultas, reaproveitando as mesmas funções de metrics.ts.
//
// Autenticação pelo TOKEN NA PRÓPRIA URL (não header) — Claude.ai só pede "a URL do servidor
// MCP" na tela de adicionar conector, sem campo separado pra chave; embutir o token no path é o
// jeito mais simples de continuar exigindo autenticação sem precisar implementar OAuth completo
// (o pacote mcp-handler suporta OAuth via withMcpAuth, mas isso pede um authorization server de
// verdade — overkill pra uso pessoal de uma pessoa só). Token inválido devolve 404 (não 401), pra
// não confirmar pra quem estiver testando aleatoriamente que a rota existe.
const mcpHandler = createMcpHandler((server) => {
  server.registerTool(
    "consultar_vendas",
    {
      title: "Consultar vendas",
      description: "Vendas por grupo, produto, tamanho ou coleção num período. Padrão: últimos 30 dias, todos os canais.",
      inputSchema: z.object({
        dimension: z.enum(["grupo", "produto", "tamanho", "colecao"]).default("grupo"),
        canal: z.enum(["todos", "b2b", "b2c"]).default("todos"),
        from: z.string().optional().describe("Data inicial YYYY-MM-DD"),
        to: z.string().optional().describe("Data final YYYY-MM-DD"),
      }),
    },
    async ({ dimension, canal, from: fromStr, to: toStr }) => {
      const defaultFromStr = todayBrasiliaStr(new Date(Date.now() - 30 * 86400000));
      const from = fromStr ? brasiliaDayStart(fromStr) : brasiliaDayStart(defaultFromStr);
      const to = toStr ? brasiliaDayEnd(toStr) : new Date();
      const rows = await getSalesByDimension(
        { storeIds: undefined, marcas: undefined, tabelasPreco: undefined, from, to },
        dimension,
        canal
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              periodo: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
              itens: rows.slice(0, 30),
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "consultar_estoque",
    {
      title: "Consultar estoque atual",
      description: "Estoque atual agrupado por grupo, produto, tamanho ou coleção.",
      inputSchema: z.object({
        dimension: z.enum(["grupo", "produto", "tamanho", "colecao"]).default("grupo"),
      }),
    },
    async ({ dimension }) => {
      const rows = await getEstoqueAtual({ storeIds: undefined, grupoIn: undefined }, dimension);
      return { content: [{ type: "text" as const, text: JSON.stringify({ itens: rows.slice(0, 30) }) }] };
    }
  );

  server.registerTool(
    "consultar_grade",
    {
      title: "Consultar grade de tamanho",
      description: "Estoque tamanho a tamanho por loja de um produto ou grupo (busca por texto, ex: 'Classic Lisa' ou 'Classic Blue'), incluindo tamanhos zerados.",
      inputSchema: z.object({
        produto: z.string().describe("Nome ou parte do nome do grupo ou produto"),
      }),
    },
    async ({ produto }) => {
      const rows = await getGradeTamanhoBusca(produto, { storeIds: undefined });
      return { content: [{ type: "text" as const, text: JSON.stringify({ produto, itens: rows }) }] };
    }
  );
});

async function handle(request: NextRequest, params: Promise<{ token: string }>): Promise<Response> {
  const { token } = await params;
  if (!(await verifyApiToken(token))) {
    return new Response("Not found", { status: 404 });
  }
  return mcpHandler(request);
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  return handle(request, ctx.params);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  return handle(request, ctx.params);
}
