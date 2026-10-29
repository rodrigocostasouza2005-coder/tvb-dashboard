import { getSessionUser } from "@/lib/auth";
import {
  getAnaliseDistribuicaoEstoque,
  filtrarVariantes,
  filtrarTransferencias,
  DIAGNOSTICO_LABEL,
  type Confianca,
  type DiagnosticoVariante,
  type ResultadoVariante,
  type SugestaoTransferencia,
} from "@/lib/metrics";
import { getStoreRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import type { RawSearchParams } from "@/lib/filters";
import { StatTile } from "../stat-tile";
import { GetForm } from "../get-form";
import { formatNumero } from "../mapa-compras/inteligencia/format";

const POR_PAGINA = 50;

const CONFIANCA_LABEL: Record<Confianca, string> = { ALTA: "Alta", MEDIA: "Média", BAIXA: "Baixa" };
const PAPEL_LABEL = { PONTO_VENDA: "Ponto de venda", DEPOSITO: "Depósito", EXCLUIDO: "Fora de venda" } as const;

function tomDiagnostico(d: DiagnosticoVariante): string {
  switch (d) {
    case "TRANSFERENCIA_POSSIVEL":
      return "var(--series-1)";
    case "ESTOQUE_TOTAL_INSUFICIENTE":
    case "POSSIVEL_SUBALOCACAO":
      return "var(--status-critical)";
    case "POSSIVEL_EXCESSO":
    case "ESTOQUE_PARADO":
      return "var(--status-warning)";
    case "EQUILIBRADA":
      return "var(--status-good)";
    default:
      return "var(--text-muted)";
  }
}

function Badge({ label, cor }: { label: string; cor: string }) {
  return (
    <span
      className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor }}
    >
      {label}
    </span>
  );
}

function dias(v: number | null): string {
  return v == null ? "—" : `${formatNumero(v, 1)}d`;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${formatNumero(v * 100, 1)}%`;
}

function dataHora(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function str(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== "" ? s.trim() : undefined;
}

function hrefCom(params: Record<string, string | undefined>, mudanca: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...mudanca })) if (v) qs.set(k, v);
  const q = qs.toString();
  return `/dashboard/distribuicao-estoque${q ? `?${q}` : ""}`;
}

const th = "border-b border-[var(--border)] px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)]";
const td = "border-b border-[var(--gridline)] px-3 py-2 text-xs align-top";
const inputClass = "rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]";

export default async function DistribuicaoEstoquePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "distribuicao-estoque");

  const raw = await searchParams;
  const params = {
    q: str(raw.q),
    loja: str(raw.loja),
    grupo: str(raw.grupo),
    diagnostico: str(raw.diagnostico),
    confianca: str(raw.confianca),
    aba: str(raw.aba) === "variantes" ? "variantes" : "transferencias",
    pagina: str(raw.pagina),
  };
  const pagina = Math.max(Number(params.pagina) || 1, 1);

  // A análise é sempre da empresa toda (transferência é entre lojas); a permissão de loja do
  // usuário só limita o que é EXIBIDO.
  const lojasPermitidas = getStoreRestriction(user);
  const analise = await getAnaliseDistribuicaoEstoque();
  const c = analise.contagens;

  const diagnostico = params.diagnostico && params.diagnostico in DIAGNOSTICO_LABEL ? (params.diagnostico as DiagnosticoVariante) : undefined;
  const confianca = params.confianca && params.confianca in CONFIANCA_LABEL ? (params.confianca as Confianca) : undefined;
  const filtro = {
    busca: params.q,
    storeId: params.loja && lojasPermitidas.includes(params.loja) ? params.loja : undefined,
    grupo: params.grupo,
    diagnostico,
    confianca,
    lojasPermitidas,
  };
  const variantes = filtrarVariantes(analise.variantes, filtro);
  const transferencias = filtrarTransferencias(analise.transferencias, variantes, filtro);

  const lojasVisiveis = analise.locais.filter((l) => lojasPermitidas.includes(l.storeId));
  const grupos = [...new Set(analise.variantes.map((v) => v.grupo).filter((g): g is string => !!g && g !== "(sem grupo)"))].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );

  const lista = params.aba === "variantes" ? variantes : transferencias;
  const totalPaginas = Math.max(Math.ceil(lista.length / POR_PAGINA), 1);
  const inicio = (Math.min(pagina, totalPaginas) - 1) * POR_PAGINA;

  const statusLabel =
    analise.execucao.status === "COMPLETA"
      ? "Completa"
      : analise.execucao.status === "COMPLETA_COM_FALHAS"
        ? `Concluída com ${c.variantesComFalha} falha(s)`
        : "Em processamento (parcial)";
  const statusCor = analise.execucao.status === "COMPLETA" && c.reconciliado ? "var(--status-good)" : "var(--status-critical)";

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Compara estoque e demanda <strong>da mesma variante</strong> (produto + cor + tamanho = 1 SKU do DAPIC) entre
        todas as lojas e sugere remanejamentos internos. Analisa o catálogo inteiro — o ranking abaixo só ordena o que
        aparece primeiro. <strong>Nada é executado:</strong> toda transferência é sugestão para aprovação humana; o
        Radar não altera saldo nem envia comando ao DAPIC. Necessidade de <em>compra</em> fica no Mapa de Compras.
      </p>

      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-secondary)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[var(--text-primary)]">Execução {analise.execucao.id}</span>
          <Badge label={statusLabel} cor={statusCor} />
          <Badge label={c.reconciliado ? "Contagens reconciliadas" : "Contagens NÃO reconciliadas"} cor={c.reconciliado ? "var(--status-good)" : "var(--status-critical)"} />
        </div>
        <div className="mt-1 text-[var(--text-muted)]">
          Dados: último sync de estoque {dataHora(analise.ultimoSyncEstoque)} · último sync de vendas {dataHora(analise.ultimoSyncVendas)} · vendas
          de {dataHora(analise.periodo.inicio)} a {dataHora(analise.periodo.fim)} ({analise.config.janelaDemandaDias} dias) ·{" "}
          {formatNumero(analise.execucao.lotesProcessados)} lote(s) de {formatNumero(analise.config.tamanhoLote)} ·{" "}
          {formatNumero(analise.linhasEstoque)} linhas de estoque lidas
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Produtos únicos" value={formatNumero(c.produtosUnicos)} />
        <StatTile label="Variantes (SKUs) no universo" value={formatNumero(c.variantesUnicas)} subValue={`${formatNumero(c.variantesProcessadas)} processadas · ${formatNumero(c.variantesPendentes)} pendentes · ${formatNumero(c.variantesComFalha)} com falha`} />
        <StatTile label="Combinações variante × local" value={`${formatNumero(c.combinacoesProcessadas)} / ${formatNumero(c.combinacoesEsperadas)}`} subValue={`processadas / esperadas · ${c.locaisAnalisados} locais analisados, ${c.locaisExcluidos} fora de venda`} />
        <StatTile label="Diagnóstico conclusivo" value={formatNumero(c.conclusivas)} subValue={`${formatNumero(c.dadosInsuficientes)} dados insuficientes · ${formatNumero(c.naoAplicaveis)} não aplicáveis`} />
        <StatTile label="Transferências sugeridas" value={formatNumero(c.transferenciasSugeridas)} subValue={`${formatNumero(c.unidadesTransferiveis)} un no total`} />
        <StatTile label="Variantes com inconsistência" value={formatNumero(c.variantesComInconsistencia)} subValue={`${formatNumero(c.produtosComDadosAusentesOuInconsistentes)} produto(s) com dado ausente/inconsistente`} status={c.variantesComInconsistencia > 0 ? "warning" : undefined} />
        <StatTile label="Confiança" value={`${formatNumero(c.porConfianca.ALTA)} alta`} subValue={`${formatNumero(c.porConfianca.MEDIA)} média · ${formatNumero(c.porConfianca.BAIXA)} baixa`} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(Object.keys(DIAGNOSTICO_LABEL) as DiagnosticoVariante[]).map((d) => (
          <a
            key={d}
            href={hrefCom(params, { diagnostico: diagnostico === d ? undefined : d, aba: "variantes", pagina: undefined })}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]"
            style={diagnostico === d ? { borderColor: tomDiagnostico(d), color: tomDiagnostico(d) } : undefined}
          >
            {DIAGNOSTICO_LABEL[d]}: <strong className="tabular-nums">{formatNumero(c.porDiagnostico[d])}</strong>
          </a>
        ))}
      </div>

      <GetForm action="/dashboard/distribuicao-estoque" className="mb-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="aba" value={params.aba} />
        <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Produto, SKU, cor ou tamanho" className={`${inputClass} w-56`} />
        <select name="loja" defaultValue={params.loja ?? ""} className={inputClass}>
          <option value="">Todas as lojas</option>
          {lojasVisiveis
            .filter((l) => l.papel !== "EXCLUIDO")
            .map((l) => (
              <option key={l.storeId} value={l.storeId}>
                {l.nome}
              </option>
            ))}
        </select>
        <select name="grupo" defaultValue={params.grupo ?? ""} className={inputClass}>
          <option value="">Todos os grupos</option>
          {grupos.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select name="diagnostico" defaultValue={diagnostico ?? ""} className={inputClass}>
          <option value="">Todos os diagnósticos</option>
          {(Object.keys(DIAGNOSTICO_LABEL) as DiagnosticoVariante[]).map((d) => (
            <option key={d} value={d}>
              {DIAGNOSTICO_LABEL[d]}
            </option>
          ))}
        </select>
        <select name="confianca" defaultValue={confianca ?? ""} className={inputClass}>
          <option value="">Qualquer confiança</option>
          {(Object.keys(CONFIANCA_LABEL) as Confianca[]).map((k) => (
            <option key={k} value={k}>
              Confiança {CONFIANCA_LABEL[k].toLowerCase()}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
          Aplicar
        </button>
      </GetForm>

      <div className="mb-3 flex flex-wrap gap-1">
        {[
          { aba: "transferencias", label: `Sugestões de transferência (${formatNumero(transferencias.length)})` },
          { aba: "variantes", label: `Diagnóstico por variante (${formatNumero(variantes.length)})` },
        ].map((t) => (
          <a
            key={t.aba}
            href={hrefCom(params, { aba: t.aba, pagina: undefined })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              params.aba === t.aba ? "bg-[var(--series-1)] text-white" : "border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>

      {params.aba === "transferencias" ? (
        <TabelaTransferencias rows={transferencias.slice(inicio, inicio + POR_PAGINA)} />
      ) : (
        <TabelaVariantes rows={variantes.slice(inicio, inicio + POR_PAGINA)} lojasPermitidas={new Set(lojasPermitidas)} />
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>
          Mostrando {formatNumero(lista.length === 0 ? 0 : inicio + 1)}–{formatNumero(Math.min(inicio + POR_PAGINA, lista.length))} de{" "}
          {formatNumero(lista.length)} (filtro atual) · universo analisado: {formatNumero(c.variantesUnicas)} variantes
        </span>
        <span className="flex gap-2">
          {pagina > 1 && <a className="underline" href={hrefCom(params, { pagina: String(pagina - 1) })}>← anterior</a>}
          {pagina < totalPaginas && <a className="underline" href={hrefCom(params, { pagina: String(pagina + 1) })}>próxima →</a>}
        </span>
      </div>

      <details className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-secondary)]">
        <summary className="cursor-pointer font-medium text-[var(--text-primary)]">Regras, limites e limitações dos dados</summary>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-medium">Regras (configuráveis em CONFIG_DISTRIBUICAO_PADRAO)</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[var(--text-muted)]">
              <li>Venda líquida = vendas válidas − devoluções na mesma loja e janela; cancelamentos e brindes ficam fora.</li>
              <li>Velocidade = venda líquida de {analise.config.janelaDemandaDias} dias ÷ dias de vida da variante dentro da janela.</li>
              <li>Cobertura = estoque disponível ÷ velocidade. Alvo: {analise.config.coberturaAlvoDias} dias (mesma cobertura padrão do Mapa de Compras).</li>
              <li>Subalocação: cobertura &lt; {analise.config.limiarSubalocacaoDias} dias e fatia do estoque ≥ {analise.config.limiarSaldoParticipacao * 100}pp abaixo da fatia da demanda.</li>
              <li>Excesso: cobertura &gt; {analise.config.limiarExcessoDias} dias e fatia do estoque ≥ {analise.config.limiarSaldoParticipacao * 100}pp acima da fatia da demanda.</li>
              <li>Estoque parado: sem venda líquida na janela e variante com ≥ {analise.config.idadeMinimaParadoDias} dias de vida.</li>
              <li>Dados insuficientes: menos de {analise.config.minVendasLiquidasConclusivo} vendas líquidas na janela (todas as lojas), ou sem venda e idade recente/desconhecida.</li>
              <li>Insuficiência global: cobertura da empresa toda &lt; {analise.config.limiarSubalocacaoDias} dias — transferência não resolve.</li>
              <li>Transferência: só do excedente acima de {analise.config.coberturaProtegidaOrigemDias} dias de cobertura da origem (mín. {analise.config.reservaMinimaOrigemUnidades} un); destino precisa de ≥ {analise.config.minVendasDestino} vendas líquidas e recebe no máximo o que falta para {analise.config.coberturaAlvoDias} dias.</li>
            </ul>
          </div>
          <div>
            <p className="mb-1 font-medium">Limitações</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[var(--text-muted)]">
              {analise.limitacoesGlobais.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            <p className="mb-1 mt-3 font-medium">Locais</p>
            <ul className="space-y-0.5 text-[var(--text-muted)]">
              {analise.locais.map((l) => (
                <li key={l.storeId}>
                  <strong className="text-[var(--text-secondary)]">{l.nome}</strong> — {PAPEL_LABEL[l.papel]}: {l.motivoPapel}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}

function rotulo(r: { produto: string | null; cod: string; cor: string | null; tamanho: string | null }) {
  return (
    <>
      <div className="font-medium text-[var(--text-primary)]">{r.produto ?? <em>sem nome no DAPIC</em>}</div>
      <div className="text-[10px] text-[var(--text-muted)]">
        SKU {r.cod} · {r.cor ?? "cor —"} · tam. {r.tamanho ?? "—"}
      </div>
    </>
  );
}

function TabelaTransferencias({ rows }: { rows: SugestaoTransferencia[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nenhuma sugestão de transferência no filtro atual.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <table className="w-full min-w-[1100px] border-collapse">
        <thead>
          <tr>
            <th className={th}>Variante</th>
            <th className={th}>Origem → Destino</th>
            <th className={`${th} text-right`}>Qtd. sugerida</th>
            <th className={`${th} text-right`}>Estoque origem (antes → depois)</th>
            <th className={`${th} text-right`}>Estoque destino (antes → depois)</th>
            <th className={`${th} text-right`}>Vendas líq. 90d (orig. / dest.)</th>
            <th className={`${th} text-right`}>Cobertura destino</th>
            <th className={`${th} text-right`}>Cobertura origem</th>
            <th className={th}>Confiança e justificativa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="hover:bg-[var(--page-plane)]">
              <td className={td}>{rotulo(t)}</td>
              <td className={td}>
                <span className="text-[var(--text-secondary)]">{t.origem.nome}</span> → <strong>{t.destino.nome}</strong>
              </td>
              <td className={`${td} text-right text-sm font-semibold tabular-nums text-[var(--text-primary)]`}>{formatNumero(t.quantidade)}</td>
              <td className={`${td} text-right tabular-nums`}>
                {formatNumero(t.origem.estoqueDisponivelAntes)} → {formatNumero(t.origem.estoqueDisponivelDepois)}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {formatNumero(t.destino.estoqueDisponivelAntes)} → {formatNumero(t.destino.estoqueDisponivelDepois)}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {formatNumero(t.origem.vendasLiquidas90)} / {formatNumero(t.destino.vendasLiquidas90)}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {dias(t.destino.coberturaAntesDias)} → {dias(t.destino.coberturaDepoisDias)}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {t.origem.coberturaAntesDias == null ? "sem venda" : `${dias(t.origem.coberturaAntesDias)} → ${dias(t.origem.coberturaDepoisDias)}`}
              </td>
              <td className={`${td} max-w-[360px]`}>
                <Badge label={`Confiança ${CONFIANCA_LABEL[t.confianca].toLowerCase()}`} cor={t.confianca === "ALTA" ? "var(--status-good)" : t.confianca === "MEDIA" ? "var(--status-warning)" : "var(--status-critical)"} />
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{t.justificativa}</p>
                <ul className="mt-1 list-disc pl-4 text-[10px] text-[var(--text-muted)]">
                  {t.limitacoes.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaVariantes({ rows, lojasPermitidas }: { rows: ResultadoVariante[]; lojasPermitidas: Set<string> }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nenhuma variante no filtro atual.</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((v) => (
        <details key={v.cod} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
          <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
            <span className="min-w-[220px]">{rotulo(v)}</span>
            <Badge label={DIAGNOSTICO_LABEL[v.diagnostico]} cor={tomDiagnostico(v.diagnostico)} />
            <span className="text-[var(--text-muted)]">Confiança {CONFIANCA_LABEL[v.confianca].toLowerCase()}</span>
            <span className="tabular-nums text-[var(--text-secondary)]">
              Estoque disp. {formatNumero(v.estoqueDisponivelTotal)} · vendas líq. 30/60/90d {formatNumero(v.vendasLiquidas30)}/{formatNumero(v.vendasLiquidas60)}/
              {formatNumero(v.vendasLiquidas90)} · cobertura global {dias(v.coberturaGlobalDias)}
            </span>
            {v.unidadesTransferiveis > 0 && <span className="font-semibold text-[var(--series-1)]">{formatNumero(v.unidadesTransferiveis)} un remanejáveis</span>}
          </summary>
          <div className="border-t border-[var(--gridline)] p-3">
            <ul className="mb-2 list-disc pl-4 text-[11px] text-[var(--text-secondary)]">
              {v.justificativa.map((j, i) => (
                <li key={i}>{j}</li>
              ))}
            </ul>
            {(v.inconsistencias.length > 0 || v.limitacoes.length > 0) && (
              <ul className="mb-2 list-disc pl-4 text-[10px]">
                {v.inconsistencias.map((x, i) => (
                  <li key={`i${i}`} style={{ color: "var(--status-critical)" }}>
                    {x}
                  </li>
                ))}
                {v.limitacoes.map((x, i) => (
                  <li key={`l${i}`} style={{ color: "var(--status-warning)" }}>
                    {x}
                  </li>
                ))}
              </ul>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Local</th>
                    <th className={`${th} text-right`}>Físico</th>
                    <th className={`${th} text-right`}>Reservado</th>
                    <th className={`${th} text-right`}>Disponível</th>
                    <th className={`${th} text-right`}>Vendas líq. 30/60/90d</th>
                    <th className={`${th} text-right`}>Devol. / brindes / cancel. 90d</th>
                    <th className={`${th} text-right`}>Vel./dia</th>
                    <th className={`${th} text-right`}>Cobertura</th>
                    <th className={`${th} text-right`}>% estoque × % demanda</th>
                    <th className={th}>Diagnóstico da loja</th>
                  </tr>
                </thead>
                <tbody>
                  {v.lojas
                    .filter((l) => lojasPermitidas.has(l.storeId))
                    .map((l) => (
                      <tr key={l.storeId}>
                        <td className={td}>
                          <div className="font-medium">{l.nome}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {PAPEL_LABEL[l.papel]}
                            {l.semLinhaEstoque ? " · sem linha de estoque no DAPIC" : ""}
                            {l.diasDesdeUltimaVenda != null ? ` · última venda há ${l.diasDesdeUltimaVenda}d` : ""}
                          </div>
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{formatNumero(l.estoqueFisico)}</td>
                        <td className={`${td} text-right tabular-nums`}>{l.estoqueReservado == null ? "n/d" : formatNumero(l.estoqueReservado)}</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{formatNumero(l.estoqueDisponivel)}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          {formatNumero(l.vendasLiquidas30)}/{formatNumero(l.vendasLiquidas60)}/{formatNumero(l.vendasLiquidas90)}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {formatNumero(l.devolucoes90)} / {formatNumero(l.brindes90)} / {formatNumero(l.canceladas90)}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{formatNumero(l.velocidadeDiaria, 2)}</td>
                        <td className={`${td} text-right tabular-nums`}>{dias(l.coberturaDias)}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          {pct(l.participacaoEstoque)} × {pct(l.participacaoDemanda)}
                        </td>
                        <td className={`${td} max-w-[280px]`}>
                          <div className="font-medium">{l.diagnostico.replaceAll("_", " ").toLowerCase()}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{l.justificativa.join(" ")}</div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {v.transferencias.length > 0 && (
              <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                Sugestões:{" "}
                {v.transferencias.map((t) => `${formatNumero(t.quantidade)} un ${t.origem.nome} → ${t.destino.nome}`).join(" · ")} (sujeitas à aprovação humana)
              </p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
