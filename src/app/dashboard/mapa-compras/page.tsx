import { getSessionUser } from "@/lib/auth";
import {
  getMapaDeComprasDetalhado,
  getCrescimentoEsperado,
  getClassificacaoFilterOptions,
  getParametrosBestSellerPorGrupo,
  getVisaoConsolidadaCompras,
  getFilaRevisaoClassificacao,
  getAnaliseDistribuicaoEstoque,
  cruzarComDistribuicao,
  agregarPorProduto,
  type ComprasFiltro,
} from "@/lib/metrics";
import { StatusComercialProduto } from "@prisma/client";
import { getGrupoRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { MapaComprasGrid } from "./mapa-compras-grid";
import { updateCrescimentoAction } from "./actions";
import { ModoToggle } from "./inteligencia/modo-toggle";
import { parseModo } from "./inteligencia/modos";
import { InteligenciaFiltros } from "./inteligencia/filtros";
import { ConsolidadoView } from "./inteligencia/consolidado-view";
import { AlertasView } from "./inteligencia/alertas-view";
import { TabelaBestSeller, TabelaDrop, TabelaPorGrupo, TabelaPorProduto } from "./inteligencia/tabelas";

export default async function MapaComprasPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "mapa-compras");

  const grupoIn = await getGrupoRestriction(user.role);
  const [grupos, crescimentoPct] = await Promise.all([
    getMapaDeComprasDetalhado({ grupoIn }),
    getCrescimentoEsperado(),
  ]);
  // Cobertura e Crescimento alimentam a recomendação de compra da empresa toda — só ADMIN/GESTAO
  // edita (actions.ts já trava isso no servidor; aqui só escondemos o controle de quem não pode).
  const canEdit = user.role === "ADMIN" || user.role === "GESTAO";

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Razão de estoque mês a mês por grupo (clique pra abrir os produtos): Estoque inicial +
        Recebimento − Vendas − Bonificações = Estoque final, que vira o inicial do mês seguinte —
        essa conta fecha exata em toda coluna, sem resto. Colunas com fundo azulado são{" "}
        <strong>projetadas</strong>; o resto é <strong>realizado</strong>, reconstruído a partir do
        estoque atual andando pra trás até set/2025 (não é dado gravado historicamente — é a
        matemática de conservação de estoque, já que o snapshot só guarda o valor de agora). Estoque
        nunca aparece negativo, porque fisicamente nunca foi (ver como isso é calculado no aviso
        abaixo). Estoque ideal = vendas projetadas × cobertura (meses, editável por grupo).
        "Cobertura (meses)" mostra quanto o estoque no INÍCIO do mês cobre de vendas — é derivado,
        não é uma previsão à parte. Nos meses futuros, "Recebimento" já inclui o "Falta comprar" do
        próprio mês — a projeção assume que você compra o recomendado na hora, então o estoque
        projetado nunca desaba: "Falta comprar" é a recomendação acumulada de quanto comprar em cada
        mês pra manter a cobertura, não um estoque que vai faltar de verdade se você seguir a
        recomendação.
      </p>

      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
        <h2 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
          Como chegamos no número de "Vendas" projetadas (colunas futuras, por produto)
        </h2>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-[var(--text-muted)]">
          <li>Pega a receita líquida do GRUPO (não do produto) no mesmo mês do ano anterior.</li>
          <li>
            Aplica o "Crescimento de receita esperado" que você define abaixo (ex: 10% → multiplica
            por 1,10).
          </li>
          <li>
            Reparte essa receita projetada do grupo entre os produtos dele, usando o % de
            participação de cada produto na receita do grupo no último mês completo realizado —
            esse percentual fica fixo, não muda mês a mês.
          </li>
          <li>
            Converte a fatia de receita projetada de cada produto em unidades, dividindo pelo preço
            médio de venda desse produto (média dos últimos 3 meses; sem venda nesse período, cai
            pra média do histórico inteiro). Produto sem nenhuma venda histórica projeta 0.
          </li>
        </ol>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Se o "mesmo mês do ano anterior" também cair num mês futuro (grupo com pouco histórico), a
          conta usa o valor já projetado desse mês anterior como base — efeito cascata. Mesma lógica
          da sua planilha ("Crescimento do Ticket" aplicado sobre receita, ano contra ano) — você
          escolhe o número do crescimento, o resto é calculado.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--series-1)] bg-[var(--surface-1)] p-3">
        {canEdit ? (
          <form action={updateCrescimentoAction} className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-secondary)]">Crescimento de receita esperado (ano vs. ano):</label>
            <input
              type="number"
              name="crescimentoPct"
              defaultValue={crescimentoPct}
              step={1}
              className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-right text-sm tabular-nums text-[var(--text-primary)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">%</span>
            <button type="submit" className="rounded-md border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
              Salvar
            </button>
          </form>
        ) : (
          <span className="text-sm text-[var(--text-secondary)]">
            Crescimento de receita esperado (ano vs. ano): <strong>{crescimentoPct}%</strong>
          </span>
        )}
      </div>

      <p className="mb-4 text-xs text-[var(--text-muted)]">
        Como funciona a conta de "Recebimento" nos meses realizados: parte da produção registrada
        numa ordem de produção (DAPIC) num mês não vira necessariamente estoque vendável NAQUELE
        mesmo mês (pode ter ido pro armazenador de defeito da loja, ficado retida em outra etapa,
        etc. — o DAPIC separa um "armazenador de defeitos" por loja, fora do estoque disponível).
        Quando a produção registrada de um mês é maior do que cabe pra fechar a conta (Estoque
        Inicial daria negativo), "Recebimento" mostra só o que efetivamente coube — nunca o número
        completo registrado, nem um número inventado maior que ele. Os meses mais recentes (perto
        de hoje) são os mais confiáveis, já que partem direto do estoque real atual. Bonificações
        (brindes) seguem só no histórico realizado — não são projetadas pra frente (fica 0 nos
        meses futuros).
      </p>

      <MapaComprasGrid grupos={grupos} canEdit={canEdit} />

      <hr className="my-6 border-[var(--border)]" />

      <h2 className="mb-1 text-base font-semibold text-[var(--text-primary)]">
        Inteligência de Compras: Best Seller vs. Drop
      </h2>
      <p className="mb-4 text-xs text-[var(--text-muted)]">
        Separa reposição recorrente (<strong>Best Seller</strong>) de coleção limitada (
        <strong>Drop</strong>): cada uma tem uma lógica de recomendação diferente — Drop nunca
        sugere recompra automática. Produto sem classificação não aparece como nenhum dos dois,
        fica na fila de revisão (aba "Alertas e prioridades").
      </p>

      <MapaComprasInteligencia canEdit={canEdit} grupoRestricao={grupoIn} searchParams={await searchParams} />
    </div>
  );
}

async function MapaComprasInteligencia({
  canEdit,
  grupoRestricao,
  searchParams,
}: {
  canEdit: boolean;
  grupoRestricao: string[] | undefined;
  searchParams: RawSearchParams;
}) {
  const modo = parseModo(searchParams.modo);

  const grupoFiltro = toArray(searchParams.grupo);
  const colecaoFiltro = toArray(searchParams.colecao);
  const statusFiltro = toArray(searchParams.status).filter((s): s is StatusComercialProduto =>
    Object.values(StatusComercialProduto).includes(s as StatusComercialProduto)
  );
  // Sem ?horizonte= na URL, cada grupo usa a própria meta de cobertura (CoberturaMeta). Antes a
  // página sempre mandava 30 como override, então a meta por grupo nunca era usada de verdade.
  const horizonteDias = Number(searchParams.horizonte) > 0 ? Number(searchParams.horizonte) : undefined;

  // Restrição de grupo por permissão (mesma regra do resto da página) combinada com o filtro
  // explícito escolhido na tela — se o usuário tem restrição E não escolheu nada, usa a
  // restrição; se escolheu um subconjunto, a interseção vale.
  const grupoIn =
    grupoFiltro.length > 0 ? grupoFiltro.filter((g) => !grupoRestricao || grupoRestricao.includes(g)) : grupoRestricao;

  const filtro: ComprasFiltro = {
    grupoIn,
    colecaoIn: colecaoFiltro.length > 0 ? colecaoFiltro : undefined,
    statusComercialIn: statusFiltro.length > 0 ? statusFiltro : undefined,
    horizonteDiasOverride: horizonteDias,
  };

  // Modos que não são "consolidado" também partem da visão consolidada: as linhas de Best Seller e
  // Drop já vêm nela, então cada tela calcula o motor UMA vez (antes "Por grupo" rodava os dois
  // motores duas vezes). A distribuição de estoque é cacheada por versão de sync.
  const [filtroOpcoes, visao, distribuicao] = await Promise.all([
    getClassificacaoFilterOptions(),
    getVisaoConsolidadaCompras(filtro),
    modo === "best-seller" || modo === "drop" || modo === "alertas" ? getAnaliseDistribuicaoEstoque() : Promise.resolve(null),
  ]);
  const redistribuicao = distribuicao
    ? cruzarComDistribuicao([...visao.bestSeller.map((r) => r.cod), ...visao.drops.map((r) => r.cod)], distribuicao.variantes)
    : new Map();

  const filtrosUi = (
    <InteligenciaFiltros
      basePath="/dashboard/mapa-compras"
      grupos={filtroOpcoes.grupos}
      colecoes={filtroOpcoes.colecoes}
      statusComercialDisponiveis={filtroOpcoes.statusComercialEmUso}
      value={{ modo, grupoIn: grupoFiltro, colecaoIn: colecaoFiltro, statusComercialIn: statusFiltro, horizonteDias: horizonteDias ?? null }}
    />
  );

  return (
    <div>
      <ModoToggle basePath="/dashboard/mapa-compras" searchParams={searchParams} current={modo} />
      {filtrosUi}

      {modo === "consolidado" && <ConsolidadoView visao={visao} canEdit={canEdit} />}

      {modo === "best-seller" && <TabelaBestSeller rows={visao.bestSeller} redistribuicao={redistribuicao} />}

      {modo === "drop" && <TabelaDrop rows={visao.drops} redistribuicao={redistribuicao} />}

      {modo === "grupo" && <TabelaPorGrupoAsync visao={visao} canEdit={canEdit} />}

      {modo === "produto" && <TabelaPorProduto linhas={agregarPorProduto(visao.bestSeller, visao.drops)} />}

      {modo === "alertas" && (
        <AlertasAsync
          visao={visao}
          redistribuicao={redistribuicao}
          distribuicaoResumo={
            distribuicao
              ? {
                  status: distribuicao.execucao.status,
                  transferencias: distribuicao.contagens.transferenciasSugeridas,
                  unidades: distribuicao.contagens.unidadesTransferiveis,
                  insuficienciaGlobal: distribuicao.contagens.porDiagnostico.ESTOQUE_TOTAL_INSUFICIENTE,
                }
              : null
          }
        />
      )}
    </div>
  );
}

async function TabelaPorGrupoAsync({
  visao,
  canEdit,
}: {
  visao: Awaited<ReturnType<typeof getVisaoConsolidadaCompras>>;
  canEdit: boolean;
}) {
  const parametros = await getParametrosBestSellerPorGrupo();
  const coberturaMetaPorGrupo = new Map(parametros.map((p) => [p.grupo, p]));
  return (
    <TabelaPorGrupo
      porGrupo={visao.porGrupo}
      bsRows={visao.bestSeller}
      dropRows={visao.drops}
      canEdit={canEdit}
      coberturaMetaPorGrupo={coberturaMetaPorGrupo}
    />
  );
}

async function AlertasAsync({
  visao,
  redistribuicao,
  distribuicaoResumo,
}: {
  visao: Awaited<ReturnType<typeof getVisaoConsolidadaCompras>>;
  redistribuicao: ReturnType<typeof cruzarComDistribuicao>;
  distribuicaoResumo: { status: string; transferencias: number; unidades: number; insuficienciaGlobal: number } | null;
}) {
  const filaRevisao = await getFilaRevisaoClassificacao();
  return (
    <AlertasView
      bsRows={visao.bestSeller}
      dropRows={visao.drops}
      filaRevisao={filaRevisao}
      necessidadesSemCusto={visao.necessidadesSemCusto}
      redistribuicao={redistribuicao}
      distribuicaoResumo={distribuicaoResumo}
    />
  );
}
