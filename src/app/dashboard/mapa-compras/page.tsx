import { getSessionUser } from "@/lib/auth";
import { getMapaDeCompras, type MapaCompraItem } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import { updateCoberturaMetaAction } from "./actions";

function TrendBadge({ pct }: { pct: number }) {
  const cor = pct > 5 ? "var(--status-good)" : pct < -5 ? "var(--status-critical)" : "var(--text-muted)";
  const seta = pct > 5 ? "▲" : pct < -5 ? "▼" : "—";
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: cor }}>
      {seta} {pct >= 0 ? "+" : ""}{pct.toFixed(0)}%
    </span>
  );
}

function Row({ item }: { item: MapaCompraItem }) {
  return (
    <tr className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
      <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{item.grupo}</td>
      <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{item.mediaMensal.toLocaleString("pt-BR")}</td>
      <td className="px-4 py-2 text-right"><TrendBadge pct={item.tendenciaPct} /></td>
      <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{item.projecaoMensal.toLocaleString("pt-BR")}</td>
      <td className="px-4 py-2 tabular-nums text-right text-[var(--text-primary)]">{item.estoqueAtual.toLocaleString("pt-BR")}</td>
      <td className="px-4 py-2">
        <form action={updateCoberturaMetaAction} className="flex items-center justify-end gap-1">
          <input type="hidden" name="grupo" value={item.grupo} />
          <input
            type="number"
            name="mesesCobertura"
            defaultValue={item.coberturaMeses}
            min={0.1}
            step={0.1}
            className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-right text-xs tabular-nums text-[var(--text-primary)]"
          />
          <button type="submit" className="rounded-md border border-[var(--border)] px-1.5 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--page-plane)]" title="Salvar cobertura">
            ✓
          </button>
        </form>
      </td>
      <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{item.estoqueIdeal.toLocaleString("pt-BR")}</td>
      <td className="px-4 py-2 text-right">
        {item.faltaComprar > 0 ? (
          <span
            className="inline-block rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
            style={{ backgroundColor: "color-mix(in srgb, var(--status-critical) 15%, transparent)", color: "var(--status-critical)" }}
          >
            {item.faltaComprar.toLocaleString("pt-BR")}
          </span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">—</span>
        )}
      </td>
    </tr>
  );
}

export default async function MapaComprasPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "mapa-compras");

  const grupoIn = await getGrupoRestriction(user.role);
  const itens = await getMapaDeCompras({ grupoIn });
  const totalFalta = itens.reduce((s, i) => s + i.faltaComprar, 0);
  const gruposComFalta = itens.filter((i) => i.faltaComprar > 0).length;

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Quanto comprar de cada grupo pra manter a cobertura desejada. Projeção automática: média
        líquida dos últimos 3 meses completos, ajustada pela tendência do mês mais recente.
        Estoque ideal = projeção mensal × cobertura (meses) que você definir por grupo — clique no
        ✓ pra salvar depois de mudar o número.
        {gruposComFalta > 0 && (
          <span className="ml-1 font-medium text-[var(--text-primary)]">
            {gruposComFalta} grupo{gruposComFalta > 1 ? "s" : ""} precisando de compra, somando {totalFalta.toLocaleString("pt-BR")} unidades.
          </span>
        )}
      </p>

      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Grupo</th>
              <th className="px-4 py-2 font-medium text-right">Média/mês (3m)</th>
              <th className="px-4 py-2 font-medium text-right">Tendência</th>
              <th className="px-4 py-2 font-medium text-right">Projeção/mês</th>
              <th className="px-4 py-2 font-medium text-right">Estoque atual</th>
              <th className="px-4 py-2 font-medium text-right">Cobertura (meses)</th>
              <th className="px-4 py-2 font-medium text-right">Estoque ideal</th>
              <th className="px-4 py-2 font-medium text-right">Falta comprar</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <Row key={item.grupo} item={item} />
            ))}
            {itens.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem dados de venda/estoque suficientes ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
