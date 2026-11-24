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
// Achado real em 2026-11-24: os 141 SKUs Best Seller do Neon dev estavam TODOS sem mínimo
// cadastrado — a versão anterior (só "falta real") aparecia sempre vazia, sem nenhum ponto de
// partida pra cadastrar o primeiro valor. Agora duas seções separadas: "Falta repor" (já tem
// mínimo, estoque abaixo dele) e "Sem mínimo definido" (ainda não tem régua — cadastre aqui
// mesmo, sem trocar de aba). Nunca mistura as duas no mesmo grid — são ações diferentes.
export function ReposicaoBestSellerSection({
  itens,
  podeEditarMinimo,
}: {
  itens: ItemReposicaoBestSellerConsolidada[];
  podeEditarMinimo: boolean;
}) {
  const comFalta = itens.filter((i) => i.falta != null);
  const semMinimo = itens.filter((i) => i.falta == null);

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">
          Reposição Best Seller — consolidado na empresa
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {comFalta.length > 0 && <CountBadge value={comFalta.length} label="com falta real" tone="critical" />}
          {semMinimo.length > 0 && <CountBadge value={semMinimo.length} label="sem mínimo definido" tone="warning" />}
        </div>
      </div>
      <p className="mb-4 max-w-4xl text-xs text-[var(--text-secondary)]">
        Só SKUs da coleção <strong>Best Seller</strong> (campo <code>colecao</code> do produto — classificação manual
        não é usada aqui, nunca foi operacionalizada de verdade). &quot;Disponível&quot; soma o estoque de TODA a rede
        (lojas + CD/Site), nunca de uma loja isolada. &quot;Mínimo&quot; é o Estoque Mínimo Manual cadastrado pra esse SKU
        (já é um valor único pra empresa toda, não por loja) — editável direto no card, sem trocar de aba.
      </p>

      {itens.length === 0 ? (
        <p className="rounded-md border border-[var(--gridline)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
          Nenhum SKU Best Seller encontrado no filtro atual.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {comFalta.length > 0 && (
            <CardGroup titulo="Falta repor agora" subtitulo="já tem mínimo cadastrado — estoque consolidado está abaixo dele">
              {comFalta.map((item) => (
                <ReposicaoBestSellerCard key={item.cod} item={item} podeEditarMinimo={podeEditarMinimo} />
              ))}
            </CardGroup>
          )}

          {semMinimo.length > 0 && (
            <CardGroup titulo="Sem mínimo definido" subtitulo="ainda não tem régua pra saber se está em falta — cadastre o mínimo abaixo">
              {semMinimo.map((item) => (
                <ReposicaoBestSellerCard key={item.cod} item={item} podeEditarMinimo={podeEditarMinimo} />
              ))}
            </CardGroup>
          )}
        </div>
      )}
    </section>
  );
}

function CardGroup({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{titulo}</h3>
        <span className="text-[11px] text-[var(--text-muted)]">{subtitulo}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function ReposicaoBestSellerCard({
  item,
  podeEditarMinimo,
}: {
  item: ItemReposicaoBestSellerConsolidada;
  podeEditarMinimo: boolean;
}) {
  const semMinimo = item.falta == null;

  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: semMinimo ? "color-mix(in srgb, var(--status-warning) 35%, var(--border))" : "var(--border)" }}
    >
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
        {semMinimo ? (
          <div className="rounded-md border border-[var(--gridline)] px-2 py-1.5">
            <div className="text-[10px] text-[var(--text-muted)]">Falta repor</div>
            <div className="text-xs font-medium" style={{ color: "var(--status-warning)" }}>
              defina o mínimo
            </div>
          </div>
        ) : (
          <MiniStat label="Falta repor" value={item.falta} critico />
        )}
      </div>

      {podeEditarMinimo ? (
        <div className="rounded-md border border-[var(--gridline)] px-2 py-1.5">
          <div className="mb-1 text-[10px] text-[var(--text-muted)]">
            Mínimo {semMinimo ? "— cadastrar agora" : "(editar aqui)"}
          </div>
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

function CountBadge({ value, label, tone }: { value: number; label: string; tone: "critical" | "warning" }) {
  const color = tone === "critical" ? "var(--status-critical)" : "var(--status-warning)";
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {value} {label}
    </span>
  );
}

function MiniStat({ label, value, critico }: { label: string; value: number | null; critico?: boolean }) {
  return (
    <div className="rounded-md border border-[var(--gridline)] px-2 py-1.5">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div
        className="text-sm font-semibold tabular-nums"
        style={{ color: critico ? "var(--status-critical)" : "var(--text-primary)" }}
      >
        {value != null ? formatNumber(value) : "—"}
      </div>
    </div>
  );
}
