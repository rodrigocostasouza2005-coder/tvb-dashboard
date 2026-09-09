import type { NextRequest } from "next/server";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { verifyApiToken } from "@/lib/api-token";
import {
  getSalesByDimension,
  getSalesByStore,
  getReturnsByDimension,
  getEstoqueAtual,
  getGradeTamanhoBusca,
  getStores,
  resolveLojaNome,
  getLastEstoqueSyncTime,
} from "@/lib/metrics";
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
// Texto de erro devolvido como conteúdo da ferramenta (não uma exceção MCP) quando o nome de
// loja não bate com nenhuma — assim o modelo lê o erro e pode tentar de novo com um nome válido,
// em vez de a chamada simplesmente quebrar.
async function lojaInvalidaContent(loja: string) {
  const stores = await getStores();
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          erro: `Loja "${loja}" não encontrada.`,
          lojasValidas: stores.map((s) => s.name),
        }),
      },
    ],
  };
}

const mcpHandler = createMcpHandler((server) => {
  server.registerTool(
    "listar_lojas",
    {
      title: "Listar lojas/filiais",
      description: "Lista os nomes de loja/filial válidos pra usar no parâmetro 'loja' de consultar_vendas, consultar_estoque e consultar_grade.",
      inputSchema: z.object({}),
    },
    async () => {
      const stores = await getStores();
      return { content: [{ type: "text" as const, text: JSON.stringify({ lojas: stores.map((s) => s.name) }) }] };
    }
  );

  server.registerTool(
    "consultar_vendas",
    {
      title: "Consultar vendas",
      description:
        "Vendas por grupo, produto, tamanho ou coleção num período. Padrão: últimos 30 dias, todos os canais, todas as lojas. " +
        "'revenue' é a receita LÍQUIDA de desconto e frete (já como o DAPIC registra o valor do item), " +
        "mas NÃO desconta devolução nem taxa de cartão (DAPIC não expõe taxa de cartão). " +
        "Pra receita já líquida de devolução, cruze com consultar_devolucoes (mesma dimensão/período) e subtraia. " +
        "Sempre chame listar_lojas antes de usar 'loja' pela primeira vez numa conversa, pra não errar o nome.",
      inputSchema: z.object({
        dimension: z.enum(["grupo", "produto", "tamanho", "colecao"]).default("grupo"),
        canal: z.enum(["todos", "b2b", "b2c"]).default("todos"),
        from: z.string().optional().describe("Data inicial YYYY-MM-DD"),
        to: z.string().optional().describe("Data final YYYY-MM-DD"),
        loja: z.string().optional().describe("Nome da loja/filial pra filtrar (ex: 'Rio Sul', 'Barra', 'Leblon', 'Site e Atacado'). Use listar_lojas pra ver os nomes válidos. Padrão: todas as lojas."),
      }),
    },
    async ({ dimension, canal, from: fromStr, to: toStr, loja }) => {
      const storeIds = await resolveLojaNome(loja);
      if (storeIds === null) return lojaInvalidaContent(loja as string);

      const defaultFromStr = todayBrasiliaStr(new Date(Date.now() - 30 * 86400000));
      const from = fromStr ? brasiliaDayStart(fromStr) : brasiliaDayStart(defaultFromStr);
      const to = toStr ? brasiliaDayEnd(toStr) : new Date();
      const rows = await getSalesByDimension(
        { storeIds, marcas: undefined, tabelasPreco: undefined, from, to },
        dimension,
        canal
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              periodo: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
              loja: loja ?? "todas",
              itens: rows.slice(0, 30),
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "consultar_vendas_por_loja",
    {
      title: "Consultar vendas por loja",
      description:
        "Vendas quebradas por loja/filial (uma linha por loja) num período — inclui unidades, receita, pedidos (contagem distinta) e ticketMedio (receita/pedidos). " +
        "Sem 'dimension': só o total por loja. Com 'dimension': cada loja vem com uma lista 'itens' cruzando loja × grupo/produto/tamanho/colecao. " +
        "Use essa ferramenta (em vez de chamar consultar_vendas várias vezes) quando o pedido for comparar/listar todas as lojas de uma vez. " +
        "'receita' segue a mesma definição de consultar_vendas (líquida de desconto/frete, NÃO de devolução).",
      inputSchema: z.object({
        canal: z.enum(["todos", "b2b", "b2c"]).default("todos"),
        from: z.string().optional().describe("Data inicial YYYY-MM-DD"),
        to: z.string().optional().describe("Data final YYYY-MM-DD"),
        dimension: z.enum(["grupo", "produto", "tamanho", "colecao"]).optional().describe("Se informado, cruza loja × essa dimensão em vez de só o total por loja."),
      }),
    },
    async ({ canal, from: fromStr, to: toStr, dimension }) => {
      const defaultFromStr = todayBrasiliaStr(new Date(Date.now() - 30 * 86400000));
      const from = fromStr ? brasiliaDayStart(fromStr) : brasiliaDayStart(defaultFromStr);
      const to = toStr ? brasiliaDayEnd(toStr) : new Date();
      const rows = await getSalesByStore({ storeIds: undefined, marcas: undefined, tabelasPreco: undefined, from, to }, canal, dimension);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              periodo: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
              lojas: rows,
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "consultar_devolucoes",
    {
      title: "Consultar devoluções",
      description:
        "Devoluções por grupo, produto, tamanho ou coleção num período — pra cruzar com consultar_vendas e chegar na receita líquida de devolução. " +
        "'value' é o valor devolvido, 'unitsReturned' as unidades. Não tem filtro de marca/tabela de preço (DAPIC não popula esses campos de forma confiável em devolução histórica) nem de loja (a API não expõe devolução por loja de forma separada de vendas).",
      inputSchema: z.object({
        dimension: z.enum(["grupo", "produto", "tamanho", "colecao"]).default("grupo"),
        from: z.string().optional().describe("Data inicial YYYY-MM-DD"),
        to: z.string().optional().describe("Data final YYYY-MM-DD"),
      }),
    },
    async ({ dimension, from: fromStr, to: toStr }) => {
      const defaultFromStr = todayBrasiliaStr(new Date(Date.now() - 30 * 86400000));
      const from = fromStr ? brasiliaDayStart(fromStr) : brasiliaDayStart(defaultFromStr);
      const to = toStr ? brasiliaDayEnd(toStr) : new Date();
      const rows = await getReturnsByDimension({ storeIds: undefined, marcas: undefined, tabelasPreco: undefined, from, to }, dimension);
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
      description:
        "Estoque atual agrupado por grupo, produto, tamanho ou coleção. NÃO é tempo real — a sync roda ~5x/dia " +
        "(de 3-5h em 3-5h, ver 'atualizadoEm' na resposta pra saber a defasagem exata no momento da consulta).",
      inputSchema: z.object({
        dimension: z.enum(["grupo", "produto", "tamanho", "colecao"]).default("grupo"),
        loja: z.string().optional().describe("Nome da loja/filial pra filtrar (ex: 'Rio Sul', 'Barra', 'Leblon', 'Site e Atacado'). Use listar_lojas pra ver os nomes válidos. Padrão: todas as lojas."),
      }),
    },
    async ({ dimension, loja }) => {
      const storeIds = await resolveLojaNome(loja);
      if (storeIds === null) return lojaInvalidaContent(loja as string);

      const [rows, atualizadoEm] = await Promise.all([
        getEstoqueAtual({ storeIds, grupoIn: undefined }, dimension),
        getLastEstoqueSyncTime(),
      ]);
      return { content: [{ type: "text" as const, text: JSON.stringify({ loja: loja ?? "todas", atualizadoEm, itens: rows.slice(0, 30) }) }] };
    }
  );

  server.registerTool(
    "consultar_grade",
    {
      title: "Consultar grade de tamanho",
      description:
        "Estoque tamanho a tamanho por loja de um produto ou grupo (busca por texto, ex: 'Classic Lisa' ou 'Classic Blue'), incluindo tamanhos zerados. " +
        "Quanto mais completo o texto de busca, melhor o match (ex: 'Classic Blue' funciona bem; um apelido curto tipo 'Reverso' pode não bater com o nome real do produto). " +
        "'pctQuebrada' = % dos tamanhos desse produto zerados NAQUELA loja (0-100). 'gradeQuebrada' = true quando pctQuebrada >= 40%, limiar usado no resto do Radar (aba Sugestão de Retirada) pra sugerir retirar o que sobrou de lá — grade incompleta vende mal e ocupa espaço. NÃO é tempo real, ver 'atualizadoEm'.",
      inputSchema: z.object({
        produto: z.string().describe("Nome ou parte do nome do grupo ou produto"),
        loja: z.string().optional().describe("Nome da loja/filial pra restringir (ex: 'Rio Sul'). Use listar_lojas pra ver os nomes válidos. Padrão: todas as lojas (resultado já vem quebrado por loja)."),
      }),
    },
    async ({ produto, loja }) => {
      const storeIds = await resolveLojaNome(loja);
      if (storeIds === null) return lojaInvalidaContent(loja as string);

      const [rows, atualizadoEm] = await Promise.all([
        getGradeTamanhoBusca(produto, { storeIds }),
        getLastEstoqueSyncTime(),
      ]);
      return { content: [{ type: "text" as const, text: JSON.stringify({ produto, atualizadoEm, itens: rows }) }] };
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
