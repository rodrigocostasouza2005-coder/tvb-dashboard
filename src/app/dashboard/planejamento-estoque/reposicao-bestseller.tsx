import type { ItemReposicaoBestSellerConsolidada } from "@/lib/metrics";
import { formatNumber } from "./format";
import { MinimoManualForm } from "../estoque-minimo-manual/forms";

// Reposição Best Seller CONSOLIDADA na empresa (pedido do Rodrigo, 2026-11-23) — seção nova
// dentro de Planejamento de Estoque, "por enquanto" (ele pretende reformular esta aba inteira
// depois, trabalho separado — esta seção só segue o padrão visual/estrutural já existente aqui,
// não antecipa essa reformulação). Ver src/lib/metrics/reposicao-bestseller-consolidada.ts pra
// como "Disponível"/"Mínimo"/"Falta repor" são calculados (1 card por SKU = produto+cor+tamanho,
// somando TODA a rede — nunca por loja individual, isso já existe na tela de Reposição de lojas).
//
// Reaproveita a mesma linguagem visual já usada no resto do dashboard (bordas/raio/cores de
// --status-critical, pill de tag em rounded-full — mesmo padrão de
// estoque-minimo-manual/produto-detalhe.tsx) em vez de inventar um componente de card novo do
// zero.
export function ReposicaoBestSellerSection({
  itens,
  podeEditarMinimo,
}: {
  itens: ItemReposicaoBestSellerConsolidada[];
  podeEditarMinimo: boolean;
}) {
  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">
          Reposição Best Seller — consolidado na empresa
        </h2>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: "var(--status-critical)", backgroundColor: "color-mix(in srgb, var(--status-critical) 12%, transparent)" }}>
          {itens.length} com falta real
        </span>
      </div>
      <p className="mb-3 max-w-4xl text-xs text-[var(--text-secondary)]">
        Só SKUs da coleção <strong>Best Seller</strong> (campo <code>colecao</code> do produto — classificação manual
        não é usada aqui, nunca foi operacionalizada de verdade). &quot;Disponível&quot; soma o estoque de TODA a rede
        (lojas + CD/Site), nunca de uma loja isolada. &quot;Mínimo&quot; é o Estoque Mínimo Manual cadastrado pra esse SKU
        (já é um valor único pra empresa toda, não por loja). Só aparece quem tem falta real — mínimo cadastrado E
        disponível consolidado abaixo dele.
      </p>

      {itens.length === 0 ? (
        <p className="rounded-md border border-[var(--gridline)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
          Nenhum SKU Best Seller com falta real no momento (ou nenhum tem Estoque Mínimo Manual cadastrado ainda —
          veja a aba Estoque Mínimo Manual pra definir).
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {itens.map((item) => (
            <ReposicaoBestSellerCard key={item.cod} item={item} podeEditarMinimo={podeEditarMinimo} />
          ))}
        </div>
      )}
    </section>
  );
}

function ReposicaoBestSellerCard({
  item,
  podeEditarMinimo,
}: {
  item: ItemReposicaoBestSellerConsolidada;
  podeEditarMinimo: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-[var(--text-primary)]">{item.produto}</div>
        <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--text-muted)]">
          {item.cod}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Tag>Best Seller</Tag>
        {item.cor && <Tag>Cor: {item.cor}</Tag>}
        {item.tamanho && <Tag>Tamanho: {item.tamanho}</Tag>}
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2 text-center">
        <MiniStat label="Disponível" value={item.quantidadeDisponivel} />
        <MiniStat label="Falta repor" value={item.falta} critico />
      </div>

      {podeEditarMinimo ? (
        <div className="rounded-md border border-[var(--gridline)] px-2 py-1.5">
          <div className="mb-1 text-[10px] text-[var(--text-muted)]">Mínimo (editar aqui)</div>
          <MinimoManualForm
            cod={item.cod}
            minimoDefinido={item.estoqueMinimo}
            velocidadeDiariaConsolidada={item.velocidadeDiariaConsolidada}
          />
        </div>
      ) : (
        <MiniStat label="Mínimo" value={item.estoqueMinimo} />
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--text-muted)]">
      {children}
    </span>
  );
}

function MiniStat({ label, value, critico }: { label: string; value: number; critico?: boolean }) {
  return (
    <div className="rounded-md border border-[var(--gridline)] px-2 py-1.5">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div
        className="text-sm font-semibold tabular-nums"
        style={{ color: critico ? "var(--status-critical)" : "var(--text-primary)" }}
      >
        {formatNumber(value)}
      </div>
    </div>
  );
}
