// Intensidade relativa ao maior valor visível na tabela agora (não um limiar fixo) — assim a
// mesma escala de cor funciona tanto pra visão dia (valores pequenos, tipo 2-4%) quanto mês
// (valores maiores, tipo 15-25%), sem precisar de 2 paletas diferentes. Compartilhado entre a
// page (server, nível Coleção) e o CohortTable (client, níveis Grupo/Produto) pra manter a MESMA
// escala de cor nos 3 níveis — sem isso, expandir um grupo mudaria a intensidade das cores da
// coleção já visível, o que ia confundir mais que ajudar.
export function corCelula(valor: number | null, max: number): { bg: string; fg: string } {
  if (valor === null) return { bg: "transparent", fg: "var(--text-muted)" };
  if (valor <= 0 || max <= 0) return { bg: "var(--map-empty)", fg: "var(--text-muted)" };
  const frac = valor / max;
  if (frac < 0.2) return { bg: "var(--seq-1)", fg: "var(--text-primary)" };
  if (frac < 0.4) return { bg: "var(--seq-2)", fg: "var(--text-primary)" };
  if (frac < 0.6) return { bg: "var(--seq-3)", fg: "var(--text-primary)" };
  if (frac < 0.8) return { bg: "var(--seq-4)", fg: "#ffffff" };
  return { bg: "var(--seq-5)", fg: "#ffffff" };
}
