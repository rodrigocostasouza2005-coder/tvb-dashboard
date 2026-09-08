import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getSalesByDimension,
  getEstoqueAtual,
  getGradeTamanhoBusca,
  type Dimension,
  type Canal,
} from "@/lib/metrics";
import { brasiliaDayStart, brasiliaDayEnd, todayBrasiliaStr } from "@/lib/filters";
import { verifyApiToken } from "@/lib/api-token";

// API pra conectar o Radar num Custom GPT do ChatGPT (Actions) — pedido do Rodrigo em
// 2026-09-08. Uma rota só (não uma por recurso) porque ele pediu "um link só": o parâmetro
// "resource" escolhe o que consultar. Autenticação pelo token gerado no Painel Admin (ver
// lib/api-token.ts) — essa chave dá acesso a TUDO (sem a separação por loja/marca/financeiro
// que o login normal tem), então é pra uso pessoal dele, não pra compartilhar. Ver
// src/app/api/gpt/openapi/route.ts pro schema que ele cola no ChatGPT.
async function checkAuth(request: NextRequest): Promise<boolean> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  return verifyApiToken(token);
}

function isDimension(v: string | null): v is Dimension {
  return v === "grupo" || v === "produto" || v === "tamanho" || v === "colecao";
}

function isCanal(v: string | null): v is Canal {
  return v === "todos" || v === "b2b" || v === "b2c";
}

export async function GET(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const resource = params.get("resource");

  if (resource === "vendas") {
    const dimension = isDimension(params.get("dimension")) ? (params.get("dimension") as Dimension) : "grupo";
    const canal = isCanal(params.get("canal")) ? (params.get("canal") as Canal) : "todos";
    const fromStr = params.get("from");
    const toStr = params.get("to");
    // Padrão: últimos 30 dias, mesma convenção do resto do dashboard (ver DEFAULT_DIAS_ATRAS em
    // filters.ts) — sem isso, sem período explícito buscaria o histórico inteiro à toa.
    const defaultFromStr = todayBrasiliaStr(new Date(Date.now() - 30 * 86400000));
    const from = fromStr ? brasiliaDayStart(fromStr) : brasiliaDayStart(defaultFromStr);
    const to = toStr ? brasiliaDayEnd(toStr) : new Date();

    const rows = await getSalesByDimension({ storeIds: undefined, marcas: undefined, tabelasPreco: undefined, from, to }, dimension, canal);
    return NextResponse.json({
      resource: "vendas",
      dimension,
      canal,
      periodo: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      // Corta em 30 — respostas grandes demais estouram limite de tamanho do GPT Actions e
      // gastam contexto à toa pra uma pergunta em linguagem natural.
      itens: rows.slice(0, 30),
    });
  }

  if (resource === "estoque") {
    const dimension = isDimension(params.get("dimension")) ? (params.get("dimension") as Dimension) : "grupo";
    const rows = await getEstoqueAtual({ storeIds: undefined, grupoIn: undefined }, dimension);
    return NextResponse.json({
      resource: "estoque",
      dimension,
      itens: rows.slice(0, 30),
    });
  }

  if (resource === "grade") {
    const produto = params.get("produto");
    if (!produto) {
      return NextResponse.json({ error: "Parâmetro 'produto' é obrigatório pra resource=grade." }, { status: 400 });
    }
    const rows = await getGradeTamanhoBusca(produto, { storeIds: undefined });
    if (rows.length === 0) {
      return NextResponse.json({ resource: "grade", produto, itens: [], aviso: "Nenhum produto/grupo encontrado com esse nome." });
    }
    return NextResponse.json({ resource: "grade", produto, itens: rows });
  }

  return NextResponse.json(
    { error: "Parâmetro 'resource' precisa ser 'vendas', 'estoque' ou 'grade'." },
    { status: 400 }
  );
}
