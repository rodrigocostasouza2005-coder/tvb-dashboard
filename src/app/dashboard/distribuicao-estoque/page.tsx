import { getSessionUser } from "@/lib/auth";
import { getComparacaoEntreLojas, getOportunidadesTransferencia, getDistinctGrupos, getDistinctColecoes } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { DistribuicaoFiltros, type NivelDesequilibrio } from "./filtros";
import { DistribuicaoTable } from "./distribuicao-table";
import { SugestoesTransferencia } from "./sugestoes-transferencia";
import { ResumoDistribuicao } from "./resumo-distribuicao";

const NIVEIS_VALIDOS: NivelDesequilibrio[] = ["desequilibrio", "critico", "excesso", "tudo"];

export default async function DistribuicaoEstoquePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "distribuicao-estoque");

  const rawParams = await searchParams;
  const grupoFiltro = toArray(rawParams.grupo);
  const colecaoFiltro = toArray(rawParams.colecao);
  const busca = typeof rawParams.busca === "string" ? rawParams.busca : "";
  const nivelRaw = typeof rawParams.nivel === "string" ? rawParams.nivel : "desequilibrio";
  const nivel: NivelDesequilibrio = (NIVEIS_VALIDOS as string[]).includes(nivelRaw) ? (nivelRaw as NivelDesequilibrio) : "desequilibrio";

  const grupoRestricao = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const grupoIn = grupoFiltro.length > 0 ? grupoFiltro.filter((g) => !grupoRestricao || grupoRestricao.includes(g)) : grupoRestricao;

  const filtro = {
    grupoIn,
    colecaoIn: colecaoFiltro.length > 0 ? colecaoFiltro : undefined,
    busca: busca.trim() || undefined,
    storeIdsPermitidas: allowedStores,
  };

  const [comparacoesTodas, oportunidades, grupos, colecoes] = await Promise.all([
    getComparacaoEntreLojas(filtro),
    getOportunidadesTransferencia(filtro),
    getDistinctGrupos(),
    getDistinctColecoes(),
  ]);

  // Filtro de "nível de desequilíbrio" é só de exibição (não muda o cálculo de oportunidades,
  // que já é sempre sobre o universo completo do filtro de grupo/coleção/busca) — reduz a lista
  // de variantes mostradas na tabela comparativa pra quem só quer ver os casos que importam.
  // "desequilibrio" (default) é NOVO (2026-11-10): qualquer status que não seja neutro
  // (equilibrado/sem_dado) em pelo menos 1 loja — sem isso, "todos" (agora "tudo", não mais
  // default) mostrava literalmente o catálogo inteiro, a maioria das linhas sem informação real
  // (ver comentário em filtros.tsx).
  const comparacoes =
    nivel === "tudo"
      ? comparacoesTodas
      : comparacoesTodas.filter((c) =>
          c.porLoja.some((l) => {
            if (nivel === "critico") return l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica";
            if (nivel === "excesso") return l.diagnostico === "cobertura_excessiva" || l.diagnostico === "estoque_parado";
            return l.diagnostico !== "equilibrado" && l.diagnostico !== "sem_dado";
          })
        );

  const exportParams = new URLSearchParams();
  for (const g of grupoFiltro) exportParams.append("grupo", g);
  for (const c of colecaoFiltro) exportParams.append("colecao", c);
  if (busca.trim()) exportParams.set("busca", busca.trim());

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-[var(--text-secondary)]">
          Compara o mesmo produto (SKU: cor+tamanho) entre as lojas físicas de varejo (Leblon, Barra,
          Rio Sul) — <strong>não é uma ferramenta de compra</strong>: nunca sugere quanto produzir
          ou comprar, só aponta quando vale a pena transferir estoque de uma loja pra outra. Isso é
          decidido pelo Mapa de Compras, uma ferramenta separada. Toda sugestão aqui é uma
          recomendação — a aprovação e a execução da transferência são feitas pela equipe, fora do
          Radar.
        </p>
        <a
          href={`/api/export/distribuicao-estoque?${exportParams.toString()}`}
          className="whitespace-nowrap rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
        >
          Exportar Excel
        </a>
      </div>

      <ResumoDistribuicao comparacoes={comparacoesTodas} oportunidades={oportunidades} />

      <DistribuicaoFiltros
        basePath="/dashboard/distribuicao-estoque"
        grupos={grupos}
        colecoes={colecoes}
        value={{ grupoIn: grupoFiltro, colecaoIn: colecaoFiltro, busca, nivel }}
      />

      <SugestoesTransferencia oportunidades={oportunidades} />

      <p className="mb-2 text-xs text-[var(--text-muted)]">
        Mostrando {comparacoes.length.toLocaleString("pt-BR")} de {comparacoesTodas.length.toLocaleString("pt-BR")}{" "}
        variantes no filtro de grupo/coleção/busca atual
        {nivel !== "tudo" && " — as com estoque equilibrado ou sem dado suficiente ficam escondidas por padrão"}.
        {nivel !== "tudo" && " Use \"Nível de desequilíbrio: Tudo\" acima pra ver o catálogo completo."}
      </p>
      <DistribuicaoTable variantes={comparacoes} />
    </div>
  );
}
