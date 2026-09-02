import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSugestoesRetiradaEstoque } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import ExcelJS from "exceljs";

// Exportação por loja (1 botão por cartão na aba Sugestão de Retirada) — pedido do Rodrigo em
// 2026-09-02. ?store= é obrigatório (é o botão de UM cartão específico, não a lista inteira).
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const storeId = request.nextUrl.searchParams.get("store");
  if (!storeId) return NextResponse.json({ error: "store obrigatório" }, { status: 400 });

  const allowedStores = getStoreRestriction(user);
  if (allowedStores !== undefined && !allowedStores.includes(storeId)) {
    return NextResponse.json({ error: "sem acesso a essa loja" }, { status: 403 });
  }
  const grupoIn = await getGrupoRestriction(user.role);

  const sugestoes = await getSugestoesRetiradaEstoque({ storeIds: [storeId], grupoIn });
  if (sugestoes.length === 0) {
    return NextResponse.json({ error: "sem sugestões pra essa loja" }, { status: 404 });
  }
  const loja = sugestoes[0].loja;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Retirada");

  ws.addRow(["Loja", "Grupo", "Produto", "% grade quebrada", "Tamanhos zerados", "Tamanhos com estoque", "Unidades restantes"]);
  for (const s of sugestoes) {
    ws.addRow([
      s.loja,
      s.grupo,
      s.produto,
      `${s.pctQuebrada.toFixed(0)}%`,
      `${s.tamanhosZerados}/${s.tamanhosTotal}`,
      s.tamanhosComEstoque.map((t) => `${t.tamanho} (${t.quantidade})`).join(", "),
      s.estoqueRestante,
    ]);
  }
  ws.columns.forEach((col) => { col.width = 22; });

  const buf = await wb.xlsx.writeBuffer();
  const nomeArquivo = loja.replace(/[^a-zA-Z0-9]+/g, "-");

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="retirada-${nomeArquivo}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
