import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAniversariantesDoMes } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import ExcelJS from "exceljs";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

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

  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const grupoIn = await getGrupoRestriction(user.role);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };
  const vendedor = typeof rawParams.vendedor === "string" && rawParams.vendedor ? rawParams.vendedor : null;
  const mesParsed = typeof rawParams.aniversarioMes === "string" ? parseInt(rawParams.aniversarioMes, 10) : NaN;
  const mes = mesParsed >= 1 && mesParsed <= 12 ? mesParsed : new Date().getMonth() + 1;

  const clientes = await getAniversariantesDoMes(filters, vendedor, mes);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Aniversariantes ${MONTH_NAMES[mes - 1]}`);

  ws.addRow(["Dia", "Cliente", "Telefone", "Celular", "Email"]);
  for (const c of clientes) {
    ws.addRow([c.dataNascimento.getUTCDate(), c.nome, c.telefone ?? "", c.celular ?? "", c.email ?? ""]);
  }
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col) => { col.width = 22; });

  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="aniversariantes-${MONTH_NAMES[mes - 1].toLowerCase()}.xlsx"`,
    },
  });
}
