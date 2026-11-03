import type { ComparacaoVariante, OportunidadeTransferencia } from "@/lib/metrics";
import { StatTile } from "../stat-tile";

const DESEQUILIBRIO = new Set(["ruptura", "cobertura_critica", "cobertura_excessiva", "estoque_parado"]);

// Resumo no topo da tela (pedido do Rodrigo em 2026-11-02) — antes de abrir qualquer tabela,
// quantos pontos de desequilíbrio existem no filtro atual e quanto já pode ser resolvido por
// transferência entre lojas, sem precisar ler linha por linha.
export function ResumoDistribuicao({
  comparacoes,
  oportunidades,
}: {
  comparacoes: ComparacaoVariante[];
  oportunidades: OportunidadeTransferencia[];
}) {
  const unidadesTransferiveis = oportunidades.reduce((s, o) => s + o.quantidadeSugerida, 0);
  const comDesequilibrio = comparacoes.filter((c) => c.porLoja.some((l) => DESEQUILIBRIO.has(l.diagnostico))).length;
  const semDadoSuficiente = comparacoes.filter((c) => c.porLoja.every((l) => l.diagnostico === "sem_dado")).length;

  // Mini-resumo por loja: nome de cada loja, na ordem em que aparece primeiro nos dados.
  const lojas: { storeId: string; storeName: string }[] = [];
  const vistos = new Set<string>();
  for (const c of comparacoes) {
    for (const l of c.porLoja) {
      if (!vistos.has(l.storeId)) {
        vistos.add(l.storeId);
        lojas.push({ storeId: l.storeId, storeName: l.storeName });
      }
    }
  }

  const porLoja = lojas.map((loja) => {
    let precisa = 0;
    let sobra = 0;
    for (const c of comparacoes) {
      const l = c.porLoja.find((x) => x.storeId === loja.storeId);
      if (!l) continue;
      if (l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica") precisa += 1;
      else if (l.diagnostico === "cobertura_excessiva" || l.diagnostico === "estoque_parado") sobra += 1;
    }
    return { ...loja, precisa, sobra };
  });

  return (
    <div className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Sugestões de transferência" value={oportunidades.length.toLocaleString("pt-BR")} />
        <StatTile label="Unidades transferíveis" value={unidadesTransferiveis.toLocaleString("pt-BR")} />
        <StatTile
          label="Variantes com desequilíbrio"
          value={comDesequilibrio.toLocaleString("pt-BR")}
          status={comDesequilibrio > 0 ? "warning" : "good"}
        />
        <StatTile label="Sem dado suficiente" value={semDadoSuficiente.toLocaleString("pt-BR")} />
      </div>

      {porLoja.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {porLoja.map((loja) => (
            <div key={loja.storeId} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
              <div className="text-sm font-semibold text-[var(--text-primary)]">{loja.storeName}</div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                <span style={{ color: loja.precisa > 0 ? "var(--status-critical)" : undefined }}>{loja.precisa} precisa</span>
                {" · "}
                <span style={{ color: loja.sobra > 0 ? "var(--status-warning)" : undefined }}>{loja.sobra} com sobra</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
