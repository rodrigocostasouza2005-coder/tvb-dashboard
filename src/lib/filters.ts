import type { DashboardFilters, Dimension } from "@/lib/metrics";

export type RawSearchParams = { [key: string]: string | string[] | undefined };

// Datas "YYYY-MM-DD" representam um dia em horário de Brasília — sem o offset explícito, o JS
// interpreta como UTC (achado em 2026-08-11, ver comentário embaixo). Exportadas porque
// sync-runner.ts também precisa (resumo do bot usando "dia de ontem").
export const brasiliaDayStart = (dateStr: string) => new Date(`${dateStr}T00:00:00.000-03:00`);
export const brasiliaDayEnd = (dateStr: string) => new Date(`${dateStr}T23:59:59.999-03:00`);
export const todayBrasiliaStr = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);

export function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export type FilterRestrictions = {
  allowedStoreIds?: string[];
  allowedMarcas?: string[];
  allowedTabelasPreco?: string[];
};

// Duas correções aqui, achadas testando a restrição de Marca em 2026-08-12:
// 1) Se o usuário restrito tentava forçar um valor NÃO permitido pela URL, o cruzamento dava
//    lista vazia — e "vazio = sem filtro" removia a restrição inteira, mostrando TUDO em vez de
//    só o permitido (já existia também na restrição de Loja original). Corrigido: cruzamento
//    vazio cai pro conjunto permitido inteiro (nunca fica vazio quando HÁ restrição).
// 2) `allowed` agora pode ser uma restrição de verdade "vazio = nada liberado" (default-deny,
//    pedido do Rodrigo) — só quando `allowed` é genuinamente `undefined` (chamada sem nenhuma
//    restrição, ex: script local) é que "usuário não escolheu nada" deve virar `undefined`
//    (sem filtro, mostra tudo). Com `allowed` definido (mesmo `[]`), "não escolheu nada" tem
//    que usar `allowed` como default, não virar undefined.
function crossWithAllowed(chosen: string[], allowed: string[] | undefined): string[] | undefined {
  if (allowed === undefined) return chosen.length ? chosen : undefined;
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
  // Padrão: últimos 30 dias (não mais o histórico inteiro desde set/2025) — pedido do Rodrigo em
  // 2026-09-01, abrir cada aba já direto no período recente em vez de sempre carregar tudo. Dá
  // pra ampliar manualmente pelo filtro de data quando quiser ver mais.
  const DEFAULT_DIAS_ATRAS = 30;
  const defaultFromStr = todayBrasiliaStr(new Date(now.getTime() - DEFAULT_DIAS_ATRAS * 86400000));

  const from =
    typeof params.from === "string" && params.from
      ? brasiliaDayStart(params.from)
      : brasiliaDayStart(defaultFromStr);
  // "to" default (sem parâmetro) já é o instante atual — não precisa esticar até o fim do dia
  // porque não existe dado no futuro pra esconder. Só quando vem explícito do filtro é que
  // precisa virar "fim do dia em Brasília" pra incluir o dia inteiro escolhido.
  const to = typeof params.to === "string" && params.to ? brasiliaDayEnd(params.to) : now;

  // NÃO colapsa mais lista vazia pra undefined aqui — desde 2026-08-12, vazio pode significar
  // de propósito "restrito a nada" (default-deny), e "undefined" passaria batido pelas queries
  // (storeId/marca/tabelaPreco não filtrados = mostra tudo, o oposto do que se quer). Como toda
  // página agora sempre passa uma restrição concreta (getStoreRestriction/getMarcaRestriction/
  // getTabelaPrecoRestriction nunca mais devolvem undefined), esses campos também são sempre
  // concretos — undefined só sobra pra chamadas que genuinamente não passam restrição nenhuma
  // (ex: scripts locais chamando parseFilters sem 2º argumento).
  return {
    storeIds,
    marcas,
    tabelasPreco,
    from,
    to,
  };
}

export function parseDimension(params: RawSearchParams): Dimension {
  const v = typeof params.dim === "string" ? params.dim : "grupo";
  return v === "produto" || v === "tamanho" || v === "colecao" ? v : "grupo";
}

// Usa o dia em horário de Brasília, não UTC (senão o campo podia voltar mostrando o dia errado
// depois de aplicar o filtro perto da virada da meia-noite — mesma causa do bug de range).
export function toDateInputValue(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
}
