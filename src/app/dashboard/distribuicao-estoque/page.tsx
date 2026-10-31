import { getSessionUser } from "@/lib/auth";
import { getComparacaoEntreLojas, getOportunidadesTransferencia, getDistinctGrupos, getDistinctColecoes } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { DistribuicaoFiltros, type NivelDesequilibrio } from "./filtros";
import { DistribuicaoTable } from "./distribuicao-table";
import { SugestoesTransferencia } from "./sugestoes-transferencia";

const NIVEIS_VALIDOS: NivelDesequilibrio[] = ["todos", "critico", "excesso"];

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
  const nivelRaw = typeof rawParams.nivel === "string" ? rawParams.nivel : "todos";
  const nivel: NivelDesequilibrio = (NIVEIS_VALIDOS as string[]).includes(nivelRaw) ? (nivelRaw as NivelDesequilibrio) : "todos";

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
  // de produtos mostrados na tabela comparativa pra quem só quer ver os casos extremos.
  const comparacoes =
    nivel === "todos"
      ? comparacoesTodas
      : comparacoesTodas.filter((c) =>
          c.porLoja.some((l) =>
            nivel === "critico"
              ? l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica"
              : l.diagnostico === "cobertura_excessiva" || l.diagnostico === "estoque_parado"
          )
        );

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Compara o mesmo produto (SKU: cor+tamanho) entre as lojas físicas de varejo (Leblon, Barra,
        Rio Sul) — <strong>não é uma ferramenta de compra</strong>: nunca sugere quanto produzir
        ou comprar, só aponta quando vale a pena transferir estoque de uma loja pra outra. Isso é
        decidido pelo Mapa de Compras, uma ferramenta separada. Toda sugestão aqui é uma
        recomendação — a aprovação e a execução da transferência são feitas pela equipe, fora do
        Radar.
      </p>

      <DistribuicaoFiltros
        basePath="/dashboard/distribuicao-estoque"
        grupos={grupos}
        colecoes={colecoes}
        value={{ grupoIn: grupoFiltro, colecaoIn: colecaoFiltro, busca, nivel }}
      />

      <SugestoesTransferencia oportunidades={oportunidades} />

      <DistribuicaoTable variantes={comparacoes} />
    </div>
  );
}
