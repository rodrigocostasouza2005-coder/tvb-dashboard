import { getSessionUser } from "@/lib/auth";
import {
  getComparacaoCompleta,
  getMovimentacoesRecomendadas,
  getVisaoGeralDistribuicao,
  getAnaliseGrade,
  getHistoricoMovimentacoes,
  getDistinctGrupos,
  getDistinctColecoes,
  getDistinctTamanhos,
  getUnidadesDistribuicao,
  type Prioridade,
  type TipoMovimentacao,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { DistribuicaoFiltros, type NivelDesequilibrio } from "./filtros";
import { DistribuicaoTable } from "./distribuicao-table";
import { AbaNav, parseAba } from "./aba-nav";
import { VisaoGeralDistribuicaoView } from "./visao-geral";
import { MovimentacoesTable } from "./movimentacoes";
import { AnaliseGrade } from "./analise-grade";
import { HistoricoMovimentacoesView } from "./historico";

const NIVEIS_VALIDOS: NivelDesequilibrio[] = ["desequilibrio", "critico", "excesso", "tudo"];
const TIPOS_VALIDOS: TipoMovimentacao[] = ["loja_loja", "cd_site_loja", "loja_cd_site"];
const PRIORIDADES_VALIDAS: Prioridade[] = ["alta", "media", "baixa"];

const BASE_PATH = "/dashboard/distribuicao-estoque";

export default async function DistribuicaoEstoquePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "distribuicao-estoque");

  const rawParams = await searchParams;
  const aba = parseAba(rawParams.aba);
  const grupoFiltro = toArray(rawParams.grupo);
  const colecaoFiltro = toArray(rawParams.colecao);
  const tamanhoFiltro = toArray(rawParams.tamanho);
  const origemFiltro = toArray(rawParams.origem);
  const destinoFiltro = toArray(rawParams.destino);
  const tipoFiltro = toArray(rawParams.tipo).filter((t): t is TipoMovimentacao => (TIPOS_VALIDOS as string[]).includes(t));
  const prioridadeFiltro = toArray(rawParams.prioridade).filter((p): p is Prioridade =>
    (PRIORIDADES_VALIDAS as string[]).includes(p)
  );
  const busca = typeof rawParams.busca === "string" ? rawParams.busca : "";
  const nivelRaw = typeof rawParams.nivel === "string" ? rawParams.nivel : "desequilibrio";
  const nivel: NivelDesequilibrio = (NIVEIS_VALIDOS as string[]).includes(nivelRaw) ? (nivelRaw as NivelDesequilibrio) : "desequilibrio";

  const grupoRestricao = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const grupoIn = grupoFiltro.length > 0 ? grupoFiltro.filter((g) => !grupoRestricao || grupoRestricao.includes(g)) : grupoRestricao;

  const filtro = {
    grupoIn,
    colecaoIn: colecaoFiltro.length > 0 ? colecaoFiltro : undefined,
    tamanhoIn: tamanhoFiltro.length > 0 ? tamanhoFiltro : undefined,
    busca: busca.trim() || undefined,
    storeIdsPermitidas: allowedStores,
  };
  const filtroMovimentacoes = {
    ...filtro,
    tipoIn: tipoFiltro,
    prioridadeIn: prioridadeFiltro,
    origemIn: origemFiltro,
    destinoIn: destinoFiltro,
  };

  // Decisão sobre recomendação de distribuição é ação de gestão (actions.ts trava no servidor;
  // aqui só esconde o controle de quem não pode) — mesmo padrão do Mapa de Compras.
  const podeDecidir = user.role === "ADMIN" || user.role === "GESTAO";

  const [grupos, colecoes, tamanhos, unidades] = await Promise.all([
    getDistinctGrupos(),
    getDistinctColecoes(),
    getDistinctTamanhos(),
    // Só pras opções de Origem/Destino do filtro — a lista de posições é a mesma em toda aba.
    getUnidadesDistribuicao(allowedStores),
  ]);

  const exportParams = new URLSearchParams();
  for (const g of grupoFiltro) exportParams.append("grupo", g);
  for (const c of colecaoFiltro) exportParams.append("colecao", c);
  for (const t of tamanhoFiltro) exportParams.append("tamanho", t);
  for (const o of origemFiltro) exportParams.append("origem", o);
  for (const d of destinoFiltro) exportParams.append("destino", d);
  for (const t of tipoFiltro) exportParams.append("tipo", t);
  for (const p of prioridadeFiltro) exportParams.append("prioridade", p);
  if (busca.trim()) exportParams.set("busca", busca.trim());

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-4xl text-sm text-[var(--text-secondary)]">
          Compara o mesmo produto (SKU: cor+tamanho) entre <strong>todas as posições de estoque comerciais</strong> —
          as lojas de varejo e o CD/Site (uma posição única, CD + Atacado) — nas 3 direções: loja↔loja,
          CD/Site→loja (abastecimento) e loja→CD/Site (recolhimento pro ecommerce).{" "}
          <strong>Não é uma ferramenta de compra</strong>: nunca sugere quanto produzir ou comprar, isso é do Mapa de
          Compras. Toda linha aqui é uma recomendação — a movimentação física nunca é executada pelo Radar.
        </p>
        <a
          href={`/api/export/distribuicao-estoque?${exportParams.toString()}`}
          className="whitespace-nowrap rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
        >
          Exportar Excel
        </a>
      </div>

      <AbaNav basePath={BASE_PATH} searchParams={rawParams} atual={aba} />

      {aba !== "historico" && (
        <DistribuicaoFiltros
          basePath={BASE_PATH}
          aba={aba}
          grupos={grupos}
          colecoes={colecoes}
          tamanhos={tamanhos}
          unidades={unidades}
          value={{
            grupoIn: grupoFiltro,
            colecaoIn: colecaoFiltro,
            tamanhoIn: tamanhoFiltro,
            busca,
            nivel,
            origemIn: origemFiltro,
            destinoIn: destinoFiltro,
            tipoIn: tipoFiltro,
            prioridadeIn: prioridadeFiltro,
          }}
        />
      )}

      {aba === "visao-geral" && <AbaVisaoGeral filtro={filtro} nivel={nivel} />}
      {aba === "movimentacoes" && <AbaMovimentacoes filtro={filtroMovimentacoes} podeDecidir={podeDecidir} />}
      {aba === "grade" && <AbaGrade filtro={filtro} />}
      {aba === "historico" && <AbaHistorico podeDecidir={podeDecidir} />}
    </div>
  );
}

type Filtro = Parameters<typeof getVisaoGeralDistribuicao>[0];

async function AbaVisaoGeral({ filtro, nivel }: { filtro: Filtro; nivel: NivelDesequilibrio }) {
  const [visao, comparacao] = await Promise.all([getVisaoGeralDistribuicao(filtro), getComparacaoCompleta(filtro)]);

  // Filtro de "nível de desequilíbrio" é só de exibição (não muda o cálculo de movimentações, que
  // é sempre sobre o universo completo do filtro de grupo/coleção/tamanho/busca) — reduz a lista
  // de variantes mostradas na tabela comparativa pra quem só quer ver os casos que importam.
  // "desequilibrio" (default) = qualquer status que não seja neutro (equilibrado/sem_dado) em pelo
  // menos 1 posição — sem isso, "tudo" mostrava literalmente o catálogo inteiro, a maioria das
  // linhas sem informação real.
  const variantes =
    nivel === "tudo"
      ? comparacao.variantes
      : comparacao.variantes.filter((c) =>
          c.porLoja.some((l) => {
            if (nivel === "critico") return l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica";
            if (nivel === "excesso") return l.diagnostico === "cobertura_excessiva" || l.diagnostico === "estoque_parado";
            return l.diagnostico !== "equilibrado" && l.diagnostico !== "sem_dado";
          })
        );

  // Teto de exibição da tabela de detalhe: no dev real são ~2,6k variantes × 4 unidades, e sem
  // teto o HTML da página passava de 10 mil células só nesse bloco (lento de renderizar e
  // impossível de ler). O resumo acima continua sendo sobre o universo COMPLETO do filtro — só o
  // detalhe linha-a-linha é truncado, e a tela diz isso explicitamente.
  const TETO_VARIANTES = 400;
  const visiveis = variantes.slice(0, TETO_VARIANTES);

  return (
    <div className="space-y-4">
      <VisaoGeralDistribuicaoView visao={visao} />
      <div>
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Detalhe por variante: mostrando {visiveis.length.toLocaleString("pt-BR")} de{" "}
          {comparacao.variantes.length.toLocaleString("pt-BR")} variantes no filtro atual
          {nivel !== "tudo" && " — as com estoque equilibrado ou sem dado suficiente ficam escondidas por padrão"}.
          {nivel !== "tudo" && ' Use "Nível de desequilíbrio: Tudo" acima pra ver o catálogo completo.'}
          {variantes.length > TETO_VARIANTES &&
            ` Lista truncada em ${TETO_VARIANTES} variantes — refine grupo/coleção/tamanho/busca pra ver o resto (os números do resumo acima continuam sobre o filtro inteiro).`}
        </p>
        <DistribuicaoTable variantes={visiveis} />
      </div>
    </div>
  );
}

async function AbaMovimentacoes({
  filtro,
  podeDecidir,
}: {
  filtro: Parameters<typeof getMovimentacoesRecomendadas>[0];
  podeDecidir: boolean;
}) {
  const resultado = await getMovimentacoesRecomendadas(filtro);
  return (
    <MovimentacoesTable
      movimentacoes={resultado.movimentacoes}
      manter={resultado.manter}
      necessidadesNaoAtendidas={resultado.necessidadesNaoAtendidas}
      totalAntesDoFiltro={resultado.totalAntesDoFiltro}
      podeDecidir={podeDecidir}
    />
  );
}

async function AbaGrade({ filtro }: { filtro: Filtro }) {
  const dados = await getAnaliseGrade(filtro);
  return <AnaliseGrade dados={dados} />;
}

async function AbaHistorico({ podeDecidir }: { podeDecidir: boolean }) {
  const historico = await getHistoricoMovimentacoes();
  return <HistoricoMovimentacoesView historico={historico} podeDecidir={podeDecidir} />;
}
