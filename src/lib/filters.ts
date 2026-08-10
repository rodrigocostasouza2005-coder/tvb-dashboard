import type { DashboardFilters, Dimension } from "@/lib/metrics";

export type RawSearchParams = { [key: string]: string | string[] | undefined };

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// allowedStoreIds: restrição por usuário (ver getStoreRestriction em lib/permissions.ts).
// undefined = sem restrição. Se o usuário escolheu lojas específicas no filtro, cruza com o
// que ele tem permissão de ver; se não escolheu nenhuma, o padrão já vira só as permitidas —
// trava de verdade, não dá pra contornar digitando outro id de loja na URL.
export function parseFilters(params: RawSearchParams, allowedStoreIds?: string[]): DashboardFilters {
  // Opções de loja agrupadas (ex: CD+ATACADO) chegam como "id1|id2" — expande de volta.
  let storeIds = toArray(params.store).flatMap((v) => v.split("|"));
  const marcas = toArray(params.marca);
  const tabelasPreco = toArray(params.tabelaPreco);

  if (allowedStoreIds) {
    storeIds = storeIds.length
      ? storeIds.filter((id) => allowedStoreIds.includes(id))
      : allowedStoreIds;
  }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 90);

  const from = typeof params.from === "string" && params.from ? new Date(params.from) : defaultFrom;
  const to = typeof params.to === "string" && params.to ? new Date(params.to) : now;
  // inclui o dia inteiro do "até"
  to.setHours(23, 59, 59, 999);

  return {
    storeIds: storeIds.length ? storeIds : undefined,
    marcas: marcas.length ? marcas : undefined,
    tabelasPreco: tabelasPreco.length ? tabelasPreco : undefined,
    from,
    to,
  };
}

export function parseDimension(params: RawSearchParams): Dimension {
  const v = typeof params.dim === "string" ? params.dim : "grupo";
  return v === "produto" || v === "tamanho" ? v : "grupo";
}

export function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}
