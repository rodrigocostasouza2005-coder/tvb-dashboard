import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getOportunidadesTransferencia, agruparOportunidadesPorPar, type ComparacaoFiltro } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { toArray, type RawSearchParams } from "@/lib/filters";
import ExcelJS from "exceljs";

// Picking list pra mandar pras lojas separarem (pedido do Rodrigo, 2026-11-10) — agrupado por par
// loja origem→destino, mesmo agrupamento da tela (agruparOportunidadesPorPar, ver
// sugestoes-transferencia.tsx), pra planilha e tela baterem exatamente. Colunas deliberadamente
// enxutas (sem cobertura/justificativa, que são pra análise, não pra quem vai separar a peça
// física): o cabeçalho de cada seção já diz origem→destino, as colunas só precisam dizer O QUE e
// QUANTO.
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
  const busca = typeof rawParams.busca === "string" ? rawParams.busca : "";

  const grupoRestricao = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const grupoIn = grupoFiltro.length > 0 ? grupoFiltro.filter((g) => !grupoRestricao || grupoRestricao.includes(g)) : grupoRestricao;

  const filtro: ComparacaoFiltro = {
    grupoIn,
    colecaoIn: colecaoFiltro.length > 0 ? colecaoFiltro : undefined,
    busca: busca.trim() || undefined,
    storeIdsPermitidas: allowedStores,
  };

  const oportunidades = await getOportunidadesTransferencia(filtro);
  const grupos = agruparOportunidadesPorPar(oportunidades);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Transferências");
  ws.columns = [
    { width: 32 }, // Produto
    { width: 14 }, // Cor
    { width: 10 }, // Tamanho
    { width: 12 }, // Código
    { width: 16 }, // Estoque atual (origem)
    { width: 18 }, // Quantidade a separar
  ];

  const ITENS_HEADER = ["Produto", "Cor", "Tamanho", "Código", "Estoque atual (origem)", "Quantidade a separar"];

  for (const grupo of grupos) {
    const linhaTitulo = ws.addRow([`${grupo.lojaOrigem} → ${grupo.lojaDestino} (${grupo.totalQuantidade} un.)`]);
    ws.mergeCells(linhaTitulo.number, 1, linhaTitulo.number, ITENS_HEADER.length);
    linhaTitulo.font = { bold: true, size: 12 };
    linhaTitulo.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };

    const linhaHeader = ws.addRow(ITENS_HEADER);
    linhaHeader.font = { bold: true };
    linhaHeader.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    });

    for (const item of grupo.itens) {
      ws.addRow([item.produto, item.cor ?? "", item.tamanho ?? "", item.cod, item.estoqueOrigemAntes, item.quantidadeSugerida]);
    }

    ws.addRow([]); // linha em branco separando o próximo par
  }

  if (grupos.length === 0) {
    ws.addRow(["Nenhuma oportunidade de transferência identificada no filtro atual."]);
  }

  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="transferencias-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
