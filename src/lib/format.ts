// Formatadores centrais de exibição (moeda, moeda compacta, percentual, número) — criado em
// 2026-10 pra parar de duplicar a mesma função em dezenas de arquivos. Usado só onde o código já
// estava sendo tocado (IndicatorChart, Pesquisa); os outros arquivos com formatBRL/formatPct
// locais continuam intactos de propósito (fora de escopo, não é uma varredura geral do app).

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// "R$ 451 mil" / "R$ 1,2 mi" — pra eixos de gráfico e espaços estreitos, onde o valor exato
// (ex: "R$ 451.234,56") poluiria. Abaixo de mil mostra o valor cheio sem decimais.
export function formatBRLCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`;
  }
  if (abs >= 1_000) {
    return `${sign}R$ ${Math.round(abs / 1_000).toLocaleString("pt-BR")} mil`;
  }
  return `${sign}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}
