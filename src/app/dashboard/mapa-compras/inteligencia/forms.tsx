import {
  classificarProdutoAction,
  setParametrosBestSellerGrupoAction,
  setOrcamentoTotalPlanejadoAction,
  confirmarDecisaoCompraAction,
} from "../classificacao-actions";
import { TipoCompraProduto, StatusComercialProduto, PossibilidadeReposicao } from "@prisma/client";
import { STATUS_COMERCIAL_LABEL, POSSIBILIDADE_REPOSICAO_LABEL } from "./format";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-1.5 py-1 text-[11px] text-[var(--text-primary)]";
const btnClass =
  "rounded-md border border-[var(--border)] px-1.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]";

// Classificação inline (seção 2/3 do pedido) — pedido do Rodrigo: ajustar no próprio elemento,
// não num formulário à parte (ver feedback_inline_controls). Usado na fila de revisão: cada
// produto pendente já mostra cod/produto/grupo (fixos, hidden), só pede o que falta decidir.
export function ClassificarProdutoForm({ cod, produto, grupo, colecao }: { cod: string; produto: string; grupo: string; colecao: string | null }) {
  return (
    <form action={classificarProdutoAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="cod" value={cod} />
      <input type="hidden" name="produto" value={produto} />
      <input type="hidden" name="grupo" value={grupo} />
      <select name="tipoCompra" required defaultValue="" className={inputClass}>
        <option value="" disabled>
          Tipo de compra
        </option>
        <option value={TipoCompraProduto.BEST_SELLER}>Best Seller</option>
        <option value={TipoCompraProduto.DROP}>Drop</option>
      </select>
      <select name="statusComercial" required defaultValue={StatusComercialProduto.ATIVO} className={inputClass}>
        {Object.values(StatusComercialProduto).map((s) => (
          <option key={s} value={s}>
            {STATUS_COMERCIAL_LABEL[s] ?? s}
          </option>
        ))}
      </select>
      <select name="possibilidadeReposicao" required defaultValue={PossibilidadeReposicao.A_CONFIRMAR} className={inputClass}>
        {Object.values(PossibilidadeReposicao).map((p) => (
          <option key={p} value={p}>
            {POSSIBILIDADE_REPOSICAO_LABEL[p] ?? p}
          </option>
        ))}
      </select>
      <input type="text" name="colecao" placeholder="Coleção/Drop (opcional)" defaultValue={colecao ?? ""} className={`${inputClass} w-32`} />
      <input type="date" name="dataLancamento" title="Data de lançamento" className={inputClass} />
      <input type="date" name="dataEncerramentoPrevista" title="Data prevista de encerramento (Drop)" className={inputClass} />
      <input type="number" name="orcamentoDrop" placeholder="Orçamento do Drop (R$)" step="0.01" className={`${inputClass} w-28`} />
      <button type="submit" className={btnClass}>
        Classificar
      </button>
    </form>
  );
}

// Decisão humana sobre uma recomendação (seção 9) — grava quantidade sugerida ORIGINAL +
// aprovada + premissas do cálculo no momento. A simulação em tela (trocar horizonte/orçamento)
// não passa por aqui — só esse clique grava algo.
export function ConfirmarDecisaoForm({
  cod,
  grupo,
  tipoCompra,
  quantidadeSugerida,
  premissas,
}: {
  cod?: string;
  grupo: string;
  tipoCompra: TipoCompraProduto;
  quantidadeSugerida: number;
  premissas: { premissas: string[]; avisos: string[] };
}) {
  return (
    <form action={confirmarDecisaoCompraAction} className="flex flex-wrap items-center gap-1.5">
      {cod && <input type="hidden" name="cod" value={cod} />}
      <input type="hidden" name="grupo" value={grupo} />
      <input type="hidden" name="tipoCompra" value={tipoCompra} />
      <input type="hidden" name="quantidadeSugerida" value={quantidadeSugerida} />
      <input type="hidden" name="premissas" value={JSON.stringify(premissas)} />
      <span className="text-[11px] text-[var(--text-muted)]">Aprovar</span>
      <input
        type="number"
        name="quantidadeAprovada"
        defaultValue={quantidadeSugerida}
        min={0}
        className={`${inputClass} w-16 text-right tabular-nums`}
      />
      <input type="text" name="justificativaAjuste" placeholder="Justificativa do ajuste (se mudou o número)" className={`${inputClass} w-44`} />
      <button type="submit" className={btnClass} title="Confirma a decisão — grava sugerido, aprovado e premissas usadas">
        Confirmar
      </button>
    </form>
  );
}

export function OrcamentoTotalForm({ valorAtual, canEdit }: { valorAtual: number | null; canEdit: boolean }) {
  if (!canEdit) {
    return (
      <span className="text-sm text-[var(--text-secondary)]">
        Orçamento total planejado: <strong>{valorAtual != null ? `R$ ${valorAtual.toLocaleString("pt-BR")}` : "não definido"}</strong>
      </span>
    );
  }
  return (
    <form action={setOrcamentoTotalPlanejadoAction} className="flex items-center gap-2">
      <label className="text-sm text-[var(--text-secondary)]">Orçamento total planejado (R$):</label>
      <input
        type="number"
        name="orcamentoTotalPlanejado"
        defaultValue={valorAtual ?? ""}
        step="0.01"
        placeholder="sem limite"
        className="w-32 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-right text-sm tabular-nums text-[var(--text-primary)]"
      />
      <button type="submit" className="rounded-md border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
        Salvar
      </button>
    </form>
  );
}

// Estoque de segurança e prazo de entrega por grupo (seção 4) — mesmo padrão inline de
// "Cobertura (meses)" em mapa-compras-grid.tsx: hidden grupo + inputs pequenos + botão ✓.
export function ParametrosGrupoForm({
  grupo,
  estoqueSegurancaUnidades,
  leadTimeDias,
  canEdit,
}: {
  grupo: string;
  estoqueSegurancaUnidades: number | null;
  leadTimeDias: number | null;
  canEdit: boolean;
}) {
  if (!canEdit) {
    return (
      <span className="text-[10px] whitespace-nowrap text-[var(--text-muted)]">
        Segurança {estoqueSegurancaUnidades ?? "—"} un · Lead time {leadTimeDias ?? "—"}d
      </span>
    );
  }
  return (
    <form action={setParametrosBestSellerGrupoAction} className="flex items-center gap-1 whitespace-nowrap">
      <input type="hidden" name="grupo" value={grupo} />
      <span className="text-[10px] text-[var(--text-muted)]">Segurança</span>
      <input
        type="number"
        name="estoqueSegurancaUnidades"
        defaultValue={estoqueSegurancaUnidades ?? ""}
        min={0}
        className="w-12 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-1 py-0.5 text-right text-[10px] tabular-nums text-[var(--text-primary)]"
      />
      <span className="text-[10px] text-[var(--text-muted)]">un · Lead time</span>
      <input
        type="number"
        name="leadTimeDias"
        defaultValue={leadTimeDias ?? ""}
        min={0}
        className="w-12 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-1 py-0.5 text-right text-[10px] tabular-nums text-[var(--text-primary)]"
      />
      <span className="text-[10px] text-[var(--text-muted)]">d</span>
      <button type="submit" className="rounded-md border border-[var(--border)] px-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]" title="Salvar">
        ✓
      </button>
    </form>
  );
}
