import type { ItemMinimoManual, SinalTransferencia } from "@/lib/metrics";
import { NIVEL_COR, NIVEL_LABEL, formatNumero } from "../estoque-minimo-manual/format";

// Dois sinais ADITIVOS da tela de Reposição de lojas (nunca alteram falta/estoqueMinimo/
// origemSugerida já calculados em getReplenishment/getReplenishmentPorVendas, src/lib/metrics/
// estoque.ts) — ver src/lib/metrics/reposicao-sinais.ts pra como os mapas usados aqui são
// montados. Mesma paleta/conceito de badge já usada em estoque-minimo-manual/format.tsx (--status-
// critical/warning/good + --text-muted), reaproveitada direto, sem inventar cor nova.

export function MinimoManualInfo({ item }: { item: ItemMinimoManual | undefined }) {
  if (!item || item.minimoDefinido == null) {
    return <span className="text-[var(--text-muted)]">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: NIVEL_COR[item.nivelAlerta] }} />
      <span className="text-[var(--text-secondary)]">
        mínimo manual: {formatNumero(item.minimoDefinido)} un., atual: {formatNumero(item.estoqueConsolidado)} un.,{" "}
        <span className="font-medium" style={{ color: NIVEL_COR[item.nivelAlerta] }}>
          {NIVEL_LABEL[item.nivelAlerta].toUpperCase()}
        </span>
      </span>
    </span>
  );
}

export function TransferenciaInfo({ sinal }: { sinal: SinalTransferencia | undefined }) {
  if (!sinal || sinal.quantidade <= 0) {
    return <span className="text-[var(--text-muted)]">—</span>;
  }
  return (
    <span className="text-xs text-[var(--text-secondary)]">
      Há {formatNumero(sinal.quantidade)} un. disponíveis pra transferência de {sinal.origens.join(", ")} antes de
      comprar/repor.
    </span>
  );
}
