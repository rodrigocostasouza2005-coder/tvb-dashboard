import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getReplenishment } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import * as XLSX from "xlsx";

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
  const filters = { ...parseFilters(rawParams), grupoIn };
  const rows = await getReplenishment(filters);

  const header = [
    "Loja",
    "Produto",
    "Grupo",
    "Tamanho",
    "Estoque atual",
    "Estoque mínimo",
    "Repor",
    "Origem sugerida",
    "Estoque na origem",
  ];

  // Coluna "Repor" é índice 6 (0-based) → coluna G
  const REPOR_COL = 6;

  const wb = XLSX.utils.book_new();
  const wsData = [
    header,
    ...rows.map((r) => [
      r.storeName,
      r.produto,
      r.grupo,
      r.tamanho ?? "",
      r.quantidadeDisponivel,
      r.estoqueMinimo,
      r.falta,
      r.origemSugerida,
      r.estoqueNaOrigem,
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Pintar o cabeçalho e todas as células da coluna "Repor" de amarelo
  const yellow = { fgColor: { rgb: "FFFF00" } };
  const numRows = wsData.length;
  for (let row = 0; row < numRows; row++) {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: REPOR_COL });
    if (!ws[cellRef]) ws[cellRef] = { v: row === 0 ? "Repor" : wsData[row][REPOR_COL], t: row === 0 ? "s" : "n" };
    ws[cellRef].s = { fill: { patternType: "solid", ...yellow } };
  }

  XLSX.utils.book_append_sheet(wb, ws, "Reposição");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reposicao-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
