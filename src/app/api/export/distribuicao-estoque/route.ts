import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getMovimentacoesRecomendadas,
  agruparMovimentacoesPorPar,
  tipoMovimentacaoLabel,
  type MovimentacoesFiltro,
  type Prioridade,
  type TipoMovimentacao,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { toArray, type RawSearchParams } from "@/lib/filters";
import ExcelJS from "exceljs";

// Picking list pra mandar pras unidades separarem (pedido do Rodrigo, 2026-11-10). Tabela única com
// origem/destino como colunas, mesmo padrão das outras exportações (Reposição, Retirada) — sem
// títulos mesclados nem cabeçalho repetido por grupo. Agrupamento por par (agruparMovimentacoesPorPar,
// o mesmo da tela) ainda define a ordem das linhas, pra planilha e tela baterem.
//
// EVOLUÇÃO 2026-11-11: a mesma aba "Transferências", com as 8 colunas originais nas MESMAS 8
// primeiras posições (quem já usa a planilha não precisa reaprender nada), ganhou as colunas que o
// Rodrigo pediu pra decisão (Referência=Código já existia, + Grupo, Estoque restante na origem,
// Estoque disponível no destino, Tipo de movimentação, Prioridade, Classificação, Confiança,
// Justificativa) e passou a incluir as 3 direções, não só loja→loja. Nada foi duplicado: cada
// informação aparece uma vez só, e as colunas de análise ficam DEPOIS das de separação física,
// pra quem só vai separar a peça continuar lendo as primeiras colunas e parar ali.
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rawParams: RawSearchParams = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    const existing = rawParams[key];
    if (existing === undefined) rawParams[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else rawParams[key] = [existing, value];
  }

  const grupoFiltro = toArray(rawParams.grupo);
  const colecaoFiltro = toArray(rawParams.colecao);
  const tamanhoFiltro = toArray(rawParams.tamanho);
  const origemFiltro = toArray(rawParams.origem);
  const destinoFiltro = toArray(rawParams.destino);
  const tipoFiltro = toArray(rawParams.tipo) as TipoMovimentacao[];
  const prioridadeFiltro = toArray(rawParams.prioridade) as Prioridade[];
  const busca = typeof rawParams.busca === "string" ? rawParams.busca : "";

  const grupoRestricao = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const grupoIn = grupoFiltro.length > 0 ? grupoFiltro.filter((g) => !grupoRestricao || grupoRestricao.includes(g)) : grupoRestricao;

  // Mesmos filtros da tela (grupo/coleção/tamanho/busca/origem/destino/tipo/prioridade) —
  // a planilha exportada é exatamente o que está na tela, nunca o universo inteiro.
  const filtro: MovimentacoesFiltro = {
    grupoIn,
    colecaoIn: colecaoFiltro.length > 0 ? colecaoFiltro : undefined,
    tamanhoIn: tamanhoFiltro.length > 0 ? tamanhoFiltro : undefined,
    busca: busca.trim() || undefined,
    storeIdsPermitidas: allowedStores,
    origemIn: origemFiltro,
    destinoIn: destinoFiltro,
    tipoIn: tipoFiltro,
    prioridadeIn: prioridadeFiltro,
  };

  const { movimentacoes } = await getMovimentacoesRecomendadas(filtro);
  const grupos = agruparMovimentacoesPorPar(movimentacoes);

  const PRIORIDADE_LABEL: Record<Prioridade, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
  const CLASSIFICACAO_LABEL: Record<string, string> = {
    REDISTRIBUIR: "Redistribuir",
    RECOLHER_PARA_CD_SITE: "Recolher para CD/Site",
    MANTER: "Manter",
  };
  const CONFIANCA_LABEL: Record<string, string> = {
    alta: "Alta",
    media: "Média",
    baixa: "Baixa (depende de validação)",
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Transferências");
  ws.columns = [
    { width: 22 }, // Loja origem
    { width: 22 }, // Loja destino
    { width: 32 }, // Produto
    { width: 14 }, // Cor
    { width: 10 }, // Tamanho
    { width: 12 }, // Código
    { width: 16 }, // Estoque atual (origem)
    { width: 18 }, // Quantidade a separar
    { width: 20 }, // Grupo
    { width: 20 }, // Estoque restante na origem
    { width: 22 }, // Estoque disponível no destino
    { width: 18 }, // Tipo de movimentação
    { width: 11 }, // Prioridade
    { width: 20 }, // Classificação
    { width: 24 }, // Confiança
    { width: 90 }, // Justificativa
  ];

  ws.addRow([
    "Loja origem",
    "Loja destino",
    "Produto",
    "Cor",
    "Tamanho",
    "Código",
    "Estoque atual (origem)",
    "Quantidade a separar",
    "Grupo",
    "Estoque restante na origem",
    "Estoque disponível no destino",
    "Tipo de movimentação",
    "Prioridade",
    "Classificação",
    "Confiança",
    "Justificativa",
  ]);

  for (const grupo of grupos) {
    for (const item of grupo.itens) {
      ws.addRow([
        grupo.lojaOrigem,
        grupo.lojaDestino,
        item.produto,
        item.cor ?? "",
        item.tamanho ?? "",
        item.cod,
        item.estoqueOrigemAntes,
        item.quantidadeSugerida,
        item.grupo,
        item.estoqueOrigemDepois,
        item.estoqueDestinoAntes,
        tipoMovimentacaoLabel(item.tipoMovimentacao),
        PRIORIDADE_LABEL[item.prioridade],
        CLASSIFICACAO_LABEL[item.classificacao] ?? item.classificacao,
        CONFIANCA_LABEL[item.confianca] ?? item.confianca,
        // Justificativa + avisos de confiança numa célula só: numa planilha, uma coluna por bullet
        // viraria 4 colunas quase sempre vazias. Avisos entram no fim, prefixados, pra ficar claro
        // o que é razão da recomendação e o que é limitação de dado.
        [...item.justificativa, ...item.avisos.map((a) => `ATENÇÃO: ${a}`)].join(" "),
      ]);
    }
  }

  if (grupos.length === 0) {
    ws.addRow(["Nenhuma movimentação recomendada no filtro atual."]);
  }

  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="transferencias-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
