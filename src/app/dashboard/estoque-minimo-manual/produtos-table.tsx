import type { ItemMinimoManual } from "@/lib/metrics";
import { formatNumero, NivelBadge, NIVEL_COR } from "./format";
import { MinimoManualForm } from "./forms";

type ProdutoAgregado = {
  produto: string;
  grupo: string;
  itens: ItemMinimoManual[];
  criticos: number;
  atencoes: number;
  normais: number;
  semMinimo: number;
};

// Agregação puramente de apresentação (1 grupo por produto) — não é lógica de negócio nova, só
// agrupa o que getEstoqueMinimoManual já calculou por cod/tamanho.
function agruparPorProduto(itens: ItemMinimoManual[]): ProdutoAgregado[] {
  const porProduto = new Map<string, ProdutoAgregado>();
  for (const item of itens) {
    let acc = porProduto.get(item.produto);
    if (!acc) {
      acc = { produto: item.produto, grupo: item.grupo, itens: [], criticos: 0, atencoes: 0, normais: 0, semMinimo: 0 };
      porProduto.set(item.produto, acc);
    }
    acc.itens.push(item);
    if (item.nivelAlerta === "CRITICO") acc.criticos += 1;
    else if (item.nivelAlerta === "ATENCAO") acc.atencoes += 1;
    else if (item.nivelAlerta === "NORMAL") acc.normais += 1;
    else acc.semMinimo += 1;
  }
  return [...porProduto.values()].sort(
    (a, b) => b.criticos - a.criticos || b.atencoes - a.atencoes || a.produto.localeCompare(b.produto, "pt-BR")
  );
}

// Redesenho (2026-11-24, achado real: Rodrigo não achava onde editar o mínimo) — o formato
// anterior exigia clicar no nome do produto, navegar pra outra renderização da página e rolar até
// uma tabela de detalhe pra só então achar o formulário de edição, 1 produto por vez. Agora cada
// produto é um <details> nativo (mesmo padrão já usado em distribuicao-estoque/distribuicao-table.tsx),
// aberto automaticamente quando tem CRÍTICO/ATENÇÃO, e o campo de edição do mínimo fica DIRETO na
// linha de cada tamanho, sem navegação nem clique extra — só expandir e editar.
export function ProdutosConsolidadoTable({
  itens,
  podeEditar,
}: {
  itens: ItemMinimoManual[];
  podeEditar: boolean;
}) {
  const grupos = agruparPorProduto(itens);

  if (grupos.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-sm text-[var(--text-muted)]">
        Nenhum produto encontrado para os filtros selecionados.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
        <span>{grupos.length} produto{grupos.length > 1 ? "s" : ""} no filtro</span>
        <span>Clique no produto pra abrir/fechar — editar o mínimo não precisa de mais nenhum clique</span>
      </div>
      {grupos.map((g) => (
        <ProdutoGrupo key={g.produto} grupo={g} podeEditar={podeEditar} />
      ))}
    </div>
  );
}

function ProdutoGrupo({ grupo, podeEditar }: { grupo: ProdutoAgregado; podeEditar: boolean }) {
  const precisaAtencao = grupo.criticos > 0 || grupo.atencoes > 0;

  return (
    <details className="group border-b border-[var(--gridline)] last:border-0" open={precisaAtencao}>
      <summary className="flex w-full cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-[var(--page-plane)] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
          <span aria-hidden className="inline-block shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-90">
            ▸
          </span>
          {grupo.produto}
          <span className="text-xs font-normal text-[var(--text-muted)]">
            ({grupo.itens.length} tamanho{grupo.itens.length > 1 ? "s" : ""} · {grupo.grupo})
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {grupo.criticos > 0 && <ContagemBadge valor={grupo.criticos} cor={NIVEL_COR.CRITICO} label="crítico" />}
          {grupo.atencoes > 0 && <ContagemBadge valor={grupo.atencoes} cor={NIVEL_COR.ATENCAO} label="atenção" />}
          {grupo.semMinimo > 0 && <ContagemBadge valor={grupo.semMinimo} cor={NIVEL_COR.SEM_MINIMO_DEFINIDO} label="sem mínimo" />}
        </div>
      </summary>

      <div className="divide-y divide-[var(--gridline)] px-4 pb-3">
        {grupo.itens.map((item) => (
          <div key={item.cod} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-sm text-[var(--text-primary)]">
                {item.cor ? `${item.cor} · ` : ""}
                {item.tamanho ?? "—"}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">({item.cod})</span>
              <NivelBadge nivel={item.nivelAlerta} />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
              <span>
                Estoque consolidado: <strong className="text-[var(--text-primary)]">{formatNumero(item.estoqueConsolidado)}</strong>
              </span>
              {podeEditar ? (
                <MinimoManualForm
                  cod={item.cod}
                  minimoDefinido={item.minimoDefinido}
                  velocidadeDiariaConsolidada={item.velocidadeDiariaConsolidada}
                />
              ) : (
                <span>Mínimo: {item.minimoDefinido != null ? formatNumero(item.minimoDefinido) : "—"}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function ContagemBadge({ valor, cor, label }: { valor: number; cor: string; label: string }) {
  return (
    <span
      className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor }}
    >
      {valor} {label}
    </span>
  );
}
