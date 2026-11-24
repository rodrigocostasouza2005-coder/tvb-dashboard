import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getEstoqueMinimoManual } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import { StatTile } from "../stat-tile";
import { NivelBadge, formatNumero } from "../estoque-minimo-manual/format";

// Aba nova (pedido do Rodrigo, 2026-11-24): "aba pra alerta de quanto estiver chegando perto" do
// Estoque Mínimo Manual (mínimo da EMPRESA TODA, não confundir com a aba "Estoque Mínimo" por
// loja — ver tabs.ts). Zero cálculo novo: mesma getEstoqueMinimoManual já usada em
// estoque-minimo-manual/page.tsx, só filtrada pra CRÍTICO/ATENÇÃO. Propósito diferente da tela de
// edição: esta é pra checagem rápida ("o que precisa de atenção hoje"), nunca pra ajustar número
// — por isso é SÓ LEITURA, com link pra ir editar quando precisar.
export default async function EstoqueMinimoAlertasPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "estoque-minimo-alertas");
  if (user.role === "VENDEDOR") redirect("/dashboard");

  const grupoRestricao = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);

  const itens = await getEstoqueMinimoManual({
    grupoIn: grupoRestricao,
    storeIdsPermitidas: allowedStores,
  });

  const criticos = itens.filter((i) => i.nivelAlerta === "CRITICO");
  const atencoes = itens.filter((i) => i.nivelAlerta === "ATENCAO");
  const emAlerta = [...criticos, ...atencoes];

  const porProduto = new Map<string, typeof emAlerta>();
  for (const item of emAlerta) {
    const lista = porProduto.get(item.produto) ?? [];
    lista.push(item);
    porProduto.set(item.produto, lista);
  }
  const produtos = [...porProduto.entries()].sort(([, a], [, b]) => {
    const criticosA = a.filter((i) => i.nivelAlerta === "CRITICO").length;
    const criticosB = b.filter((i) => i.nivelAlerta === "CRITICO").length;
    return criticosB - criticosA || a[0].produto.localeCompare(b[0].produto, "pt-BR");
  });

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Alertas de Estoque Mínimo</h1>
      <p className="mb-4 max-w-4xl text-sm text-[var(--text-secondary)]">
        Só leitura — mostra todo SKU da <strong>empresa toda</strong> (mínimo consolidado, somando todas as lojas +
        CD/Site) que já cruzou o mínimo (Crítico) ou está perto dele (Atenção). Pra editar o mínimo, use a aba{" "}
        <strong>Estoque Mínimo Manual</strong> — o link de cada produto abaixo já leva pra lá com a busca preenchida.
      </p>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-2">
        <StatTile label="Crítico" value={criticos.length.toLocaleString("pt-BR")} status={criticos.length > 0 ? "critical" : "good"} />
        <StatTile label="Atenção" value={atencoes.length.toLocaleString("pt-BR")} status={atencoes.length > 0 ? "warning" : "good"} />
      </section>

      {produtos.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-sm text-[var(--text-muted)]">
          Nenhum SKU em Crítico ou Atenção no momento.
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {produtos.map(([produto, items]) => (
            <div key={produto} className="border-b border-[var(--gridline)] px-4 py-3 last:border-0">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">{produto}</span>
                <a
                  href={`/dashboard/estoque-minimo-manual?busca=${encodeURIComponent(produto)}`}
                  className="text-xs text-[var(--series-1)] hover:underline"
                >
                  Editar mínimo →
                </a>
              </div>
              <div className="divide-y divide-[var(--gridline)]">
                {items.map((item) => (
                  <div key={item.cod} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                    <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                      {item.cor ? `${item.cor} · ` : ""}
                      {item.tamanho ?? "—"}
                      <span className="text-[var(--text-muted)]">({item.cod})</span>
                      <NivelBadge nivel={item.nivelAlerta} />
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      Mínimo: <strong className="text-[var(--text-primary)]">{formatNumero(item.minimoDefinido ?? 0)}</strong>
                      {" · "}Consolidado: <strong className="text-[var(--text-primary)]">{formatNumero(item.estoqueConsolidado)}</strong>
                      {item.diasAteCruzarMinimo != null && (
                        <>
                          {" · "}
                          {item.diasAteCruzarMinimo <= 0
                            ? "já abaixo do mínimo"
                            : `${item.diasAteCruzarMinimo.toFixed(0)}d até cruzar`}
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
