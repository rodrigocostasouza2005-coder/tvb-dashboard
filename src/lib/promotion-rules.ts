// Lógica pura de regra de desconto promocional — SEM import de servidor (prisma/db), pra poder
// ser usada tanto no fetch de dado (src/lib/metrics/promocao.ts) quanto no componente client que
// deixa o Rodrigo editar a matriz ao vivo na tela (promocao-client.tsx, "quadrinho" de sell
// through pedido em 2026-09-26).
//
// Regra extraída da planilha real do Rodrigo (ANALISE_BLACK_FRIDAY - 2026.xlsx, abas
// "sellthrough"/"analise"/"valor possível", auditada em 2026-09-25): desconto = BESTSELLER ? 10%
// fixo : lookup numa matriz Coleção × faixa de sell-through (INDEX/MATCH tipo -1, que acha a
// MENOR faixa que ainda é >= ao sell-through real — equivale a "arredonda pra cima" pra faixa
// mais próxima). Sem entrada na matriz (coleção não mapeada) cai no fallback (IFERROR da
// planilha, 10%).
export const promotionRules = {
  faixasSellThrough: [100, 75, 50, 25] as const,
  descontoBestseller: 0.10,
  descontoPadrao: 0.10, // fallback quando a coleção não tem linha na matriz (= IFERROR da planilha)
  matrizPorColecao: {
    "V26.1": [0.30, 0.30, 0.35, 0.40],
    "Drop1 Inverno.26": [0.20, 0.20, 0.25, 0.30],
    "Drop 2 Inverno 26": [0.15, 0.15, 0.20, 0.20],
  } as Record<string, number[]>,
};

export type DescontoRecomendado = { desconto: number; motivo: string };

// `matriz`/`descontoBestseller`/`descontoPadrao` são parâmetros opcionais (default = regra
// original da planilha) — o componente de edição na tela passa a versão AO VIVO, editada pelo
// Rodrigo, sem precisar duplicar a lógica de faixa/fallback.
export function getDescontoRecomendado(
  colecao: string,
  sellThroughRate: number | null,
  matriz: Record<string, number[]> = promotionRules.matrizPorColecao,
  descontoBestseller: number = promotionRules.descontoBestseller,
  descontoPadrao: number = promotionRules.descontoPadrao
): DescontoRecomendado {
  if (colecao === "BESTSELLER") {
    return { desconto: descontoBestseller, motivo: "Bestseller — desconto simbólico fixo, não depende do sell-through" };
  }
  const linha = matriz[colecao];
  if (!linha || sellThroughRate === null) {
    return { desconto: descontoPadrao, motivo: "Coleção sem regra de desconto definida — usando padrão" };
  }
  const faixas = promotionRules.faixasSellThrough;
  let idx = faixas.length - 1;
  for (let i = 0; i < faixas.length; i++) {
    if (faixas[i] >= sellThroughRate) { idx = i; break; }
  }
  const desconto = linha[idx];
  const faixaLabel = idx === 0 ? "acima de 75%" : idx === faixas.length - 1 ? `até ${faixas[idx]}%` : `${faixas[idx]}%–${faixas[idx - 1]}%`;
  const motivo =
    sellThroughRate <= 25
      ? `Sell-through baixo (faixa ${faixaLabel}) — estoque parado, desconto maior pra girar`
      : sellThroughRate >= 75
        ? `Sell-through alto (faixa ${faixaLabel}) — já vende bem, desconto mínimo`
        : `Sell-through moderado (faixa ${faixaLabel})`;
  return { desconto, motivo };
}
