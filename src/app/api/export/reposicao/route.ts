import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getReplenishment } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";

function csvEscape(value: string | number) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  const filters = { ...parseFilters(rawParams), grupoIn };
  const rows = await getReplenishment(filters);

  const header = [
    "Loja",
    "Produto",
    "Grupo",
    "Tamanho",
    "Estoque atual",
    "Estoque mínimo",
    "Falta",
    "Origem sugerida",
    "Estoque na origem",
  ];
  const lines = [header.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.storeName,
        r.produto,
        r.grupo,
        r.tamanho ?? "",
        r.quantidadeDisponivel,
        r.estoqueMinimo,
        r.falta,
        r.origemSugerida,
        r.estoqueNaOrigem,
      ]
        .map(csvEscape)
        .join(";")
    );
  }
  const csv = "﻿" + lines.join("\r\n"); // BOM pra acentuação abrir certo no Excel

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reposicao-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
