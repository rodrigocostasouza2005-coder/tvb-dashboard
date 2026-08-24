import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getReplenishment } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import ExcelJS from "exceljs";

const SIZE_ORDER: Record<string, number> = { P: 1, M: 2, G: 3, GG: 4, XG: 5, XGG: 6, "2XG": 7, "3XG": 8 };

function compareTamanho(a: string | null, b: string | null): number {
  const sa = a ?? "";
  const sb = b ?? "";
  const na = parseFloat(sa);
  const nb = parseFloat(sb);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  const oa = SIZE_ORDER[sa] ?? 99;
  const ob = SIZE_ORDER[sb] ?? 99;
  if (oa !== ob) return oa - ob;
  return sa.localeCompare(sb, "pt-BR");
}

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

  const grupoIn = await getGrupoRestriction(user.role);
  const colecaoParam = rawParams.colecao;
  const colecaoIn = Array.isArray(colecaoParam) ? colecaoParam : typeof colecaoParam === "string" && colecaoParam ? [colecaoParam] : undefined;
  const filters = { ...parseFilters(rawParams), grupoIn, colecaoIn };
  const rows = (await getReplenishment(filters)).slice().sort((a, b) =>
    a.storeName.localeCompare(b.storeName, "pt-BR") ||
    a.grupo.localeCompare(b.grupo, "pt-BR") ||
    a.produto.localeCompare(b.produto, "pt-BR") ||
    compareTamanho(a.tamanho, b.tamanho)
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Reposição");

  const header = [
    "Loja",
    "Coleção",
    "Grupo",
    "Produto",
    "Tamanho",
    "Estoque atual",
    "Estoque mínimo",
    "Repor",
    "Origem sugerida",
    "Estoque na origem",
  ];

  // Coluna "Repor" é a 8ª (1-based)
  const REPOR_COL = 8;

  ws.addRow(header);

  for (const r of rows) {
    ws.addRow([
      r.storeName,
      r.colecao ?? "",
      r.grupo,
      r.produto,
      r.tamanho ?? "",
      r.quantidadeDisponivel,
      r.estoqueMinimo,
      r.falta,
      r.origemSugerida,
      r.estoqueNaOrigem,
    ]);
  }

  // Pintar toda a coluna "Repor" de amarelo (cabeçalho + dados)
  ws.getColumn(REPOR_COL).eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFF00" },
    };
  });

  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reposicao-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
