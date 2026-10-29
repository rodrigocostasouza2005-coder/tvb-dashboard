// Os 6 modos do Mapa de Compras (Inteligência Best Seller × Drop). Fica num .ts à parte pra a
// página (validação do ?modo=) e o ModoToggle (botões) usarem a MESMA lista — e pra ter teste
// garantindo que nenhum modo some sem querer.
export type Modo = "consolidado" | "best-seller" | "drop" | "grupo" | "produto" | "alertas";

export const MODOS: { value: Modo; label: string }[] = [
  { value: "consolidado", label: "Visão consolidada" },
  { value: "best-seller", label: "Best Seller" },
  { value: "drop", label: "Drops" },
  { value: "grupo", label: "Por grupo" },
  { value: "produto", label: "Por produto" },
  { value: "alertas", label: "Alertas e prioridades" },
];

export function parseModo(raw: unknown): Modo {
  return typeof raw === "string" && MODOS.some((m) => m.value === raw) ? (raw as Modo) : "consolidado";
}
