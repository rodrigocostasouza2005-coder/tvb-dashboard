import type { DashboardFilters, Dimension } from "@/lib/metrics";

export type RawSearchParams = { [key: string]: string | string[] | undefined };

// Datas "YYYY-MM-DD" representam um dia em horário de Brasília — sem o offset explícito, o JS
// interpreta como UTC (achado em 2026-08-11, ver comentário embaixo). Exportadas porque
// sync-runner.ts também precisa (resumo do bot usando "dia de ontem").
export const brasiliaDayStart = (dateStr: string) => new Date(`${dateStr}T00:00:00.000-03:00`);
export const brasiliaDayEnd = (dateStr: string) => new Date(`${dateStr}T23:59:59.999-03:00`);
export const todayBrasiliaStr = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export type FilterRestrictions = {
  allowedStoreIds?: string[];
  allowedMarcas?: string[];
  allowedTabelasPreco?: string[];
};

// Achado real em 2026-08-12 testando a restrição de Marca: se o usuário restrito tentava forçar
// um valor NÃO permitido pela URL, o cruzamento dava lista vazia — e o "vazio = sem filtro" lá
// embaixo (storeIds.length ? storeIds : undefined) removia a restrição inteira, mostrando TUDO
// em vez de só o permitido. Esse mesmo bug já existia na restrição de Loja original (só nunca
// tinha sido testado com um valor inválido de propósito). Corrigido: cruzamento vazio cai pro
// conjunto permitido inteiro, nunca fica vazio quando há restrição — trava de verdade.
function crossWithAllowed(chosen: string[], allowed: string[] | undefined) {
  if (!allowed) return chosen;
  if (!chosen.length) return allowed;
  const intersection = chosen.filter((v) => allowed.includes(v));
  return intersection.length ? intersection : allowed;
}

// Restrições por usuário (ver getStoreRestriction/getMarcaRestriction/getTabelaPrecoRestriction
// em lib/permissions.ts). undefined = sem restrição. Se o usuário escolheu valores específicos
// no filtro, cruza com o que ele tem permissão de ver; se não escolheu nenhum, o padrão já vira
// só os permitidos — trava de verdade, não dá pra contornar digitando outro valor na URL.
export function parseFilters(params: RawSearchParams, restrictions: FilterRestrictions = {}): DashboardFilters {
  // Opções de loja agrupadas (ex: CD+ATACADO) chegam como "id1|id2" — expande de volta.
  const storeIds = crossWithAllowed(
    toArray(params.store).flatMap((v) => v.split("|")),
    restrictions.allowedStoreIds
  );
  const marcas = crossWithAllowed(toArray(params.marca), restrictions.allowedMarcas);
  const tabelasPreco = crossWithAllowed(toArray(params.tabelaPreco), restrictions.allowedTabelasPreco);

  const now = new Date();

  // "from"/"to" chegam como "YYYY-MM-DD" (input type=date) representando um dia em horário de
  // Brasília. `new Date("YYYY-MM-DD")` interpreta ISO date-only como meia-noite UTC — no servidor
  // (Vercel, UTC) isso cortava as últimas 3h do dia real (Brasília = UTC-3) e incluía 3h da noite
  // anterior por engano. Achado pelo Rodrigo em 2026-08-11 comparando contagem manual do dia
  // 10/08 com a Visão Geral. Constrói a data já com o offset de Brasília explícito no ISO string
  // em vez de deixar o JS assumir UTC. Brasil não observa horário de verão desde 2019, então o
  // offset fixo -03:00 é seguro (sem precisar de lib de timezone).
  const defaultFromDate = new Date(now);
  defaultFromDate.setDate(defaultFromDate.getDate() - 90);

  const from =
    typeof params.from === "string" && params.from
      ? brasiliaDayStart(params.from)
      : brasiliaDayStart(todayBrasiliaStr(defaultFromDate));
  // "to" default (sem parâmetro) já é o instante atual — não precisa esticar até o fim do dia
  // porque não existe dado no futuro pra esconder. Só quando vem explícito do filtro é que
  // precisa virar "fim do dia em Brasília" pra incluir o dia inteiro escolhido.
  const to = typeof params.to === "string" && params.to ? brasiliaDayEnd(params.to) : now;

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

// Usa o dia em horário de Brasília, não UTC (senão o campo podia voltar mostrando o dia errado
// depois de aplicar o filtro perto da virada da meia-noite — mesma causa do bug de range).
export function toDateInputValue(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
}
