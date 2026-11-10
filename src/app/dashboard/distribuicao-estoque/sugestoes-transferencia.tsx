import type { OportunidadeTransferencia } from "@/lib/metrics";
import { agruparOportunidadesPorPar } from "@/lib/metrics";
import { formatNumero } from "./format";

// Só leitura — nenhuma ação de aprovar/executar aqui de propósito (pedido explícito do Rodrigo:
// "nenhuma transferência deve ser executada automaticamente", e decisão já confirmada com ele de
// não persistir histórico nesta rodada). A equipe decide e executa fora do Radar.
//
// Agrupado por par loja origem→destino (pedido do Rodrigo, 2026-11-10: "separar sequência, tipo
// loja x -> loja y, loja y -> x, loja x -> loja z") — antes era uma lista corrida só ordenada por
// quantidade, misturando pares diferentes. Mesmo agrupamento (agruparOportunidadesPorPar) usado
// no Excel exportado (ver /api/export/distribuicao-estoque), pra tela e planilha baterem.
export function SugestoesTransferencia({ oportunidades }: { oportunidades: OportunidadeTransferencia[] }) {
  if (oportunidades.length === 0) {
    return (
      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Sugestões de transferência</h2>
        <p className="text-xs text-[var(--text-muted)]">
          Nenhuma oportunidade identificada no filtro atual — nada com excesso numa loja e falta real em outra ao mesmo tempo.
        </p>
      </section>
    );
  }

  const grupos = agruparOportunidadesPorPar(oportunidades);

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        Sugestões de transferência ({oportunidades.length})
      </h2>
      <div className="space-y-5">
        {grupos.map((grupo) => (
          <div key={`${grupo.lojaOrigem}->${grupo.lojaDestino}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] pb-1.5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {grupo.lojaOrigem} → {grupo.lojaDestino}
              </h3>
              <span
                className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: "color-mix(in srgb, var(--status-good) 15%, transparent)", color: "var(--status-good)" }}
              >
                {grupo.itens.length} {grupo.itens.length === 1 ? "item" : "itens"} · {formatNumero(grupo.totalQuantidade)} un.
              </span>
            </div>
            <div className="space-y-2">
              {grupo.itens.map((o, i) => (
                <div key={i} className="rounded-md border border-[var(--gridline)] p-3 text-xs">
                  <p className="mb-1.5 text-sm font-semibold text-[var(--text-primary)]">
                    Transfira {formatNumero(o.quantidadeSugerida)} un. de {o.produto}
                    {o.cor || o.tamanho ? ` (${[o.cor, o.tamanho].filter(Boolean).join("/")})` : ""}.
                  </p>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-[var(--text-primary)]">
                      {o.produto}
                      {o.cor ? ` · ${o.cor}` : ""}
                      {o.tamanho ? ` · ${o.tamanho}` : ""} <span className="text-[var(--text-muted)]">({o.cod})</span>
                    </span>
                    <span className="text-[var(--text-muted)]">{formatNumero(o.quantidadeSugerida)} un.</span>
                  </div>
                  <div className="mb-1.5 grid grid-cols-1 gap-1 text-[var(--text-secondary)] sm:grid-cols-2">
                    <span>
                      {o.lojaOrigem}: {formatNumero(o.estoqueOrigemAntes)} → {formatNumero(o.estoqueOrigemDepois)} un. (cobertura{" "}
                      {formatNumero(o.coberturaOrigemAntes, 1)} → {formatNumero(o.coberturaOrigemDepois, 1)} dias)
                    </span>
                    <span>
                      {o.lojaDestino}: {formatNumero(o.estoqueDestinoAntes)} → {formatNumero(o.estoqueDestinoDepois)} un. (cobertura{" "}
                      {formatNumero(o.coberturaDestinoAntes, 1)} → {formatNumero(o.coberturaDestinoDepois, 1)} dias)
                    </span>
                  </div>
                  <ul className="list-disc space-y-0.5 pl-4 text-[var(--text-muted)]">
                    {o.justificativa.map((j, idx) => (
                      <li key={idx}>{j}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
