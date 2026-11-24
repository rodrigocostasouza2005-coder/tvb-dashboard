import type { ProdutoExcessoDistribuicao } from "@/lib/metrics";
import { ExcessoDistribuicaoSection } from "./excesso-distribuicao";

// Aba 3 "Distribuição" (Zona 3, pedido do Rodrigo): estoque entre lojas/site/atacado/CD,
// concentração em unidade de baixa demanda, insuficiência em unidade de alta demanda,
// transferências possíveis, desequilíbrio, situações onde transferência evita compra nova.
//
// Reaproveita 100% o motor já maduro (distribuicao-estoque.ts/planejamento-distribuicao.ts via
// ExcessoDistribuicaoSection, já existente e testado) — nenhum cálculo novo aqui, só a mudança de
// que esta seção agora vive na própria aba "Distribuição" em vez de empilhada no fim do painel.
// A tabela "estoque e demanda por loja/CD" (base factual de ONDE está o estoque) já está na aba
// Visão Geral — não duplicada aqui, que foca no DIAGNÓSTICO de distribuição (excesso/ruptura/
// oportunidades), não no dado bruto por posição.
export function AbaDistribuicaoProduto({
  excesso,
  distribuicaoHref,
}: {
  excesso: ProdutoExcessoDistribuicao | null;
  distribuicaoHref: string;
}) {
  if (!excesso) {
    return (
      <div className="p-4">
        <p className="rounded-md border border-[var(--gridline)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
          Nenhum sinal de excesso, ruptura ou oportunidade de transferência identificado pra este produto no momento
          — não há dado suficiente (ou não há desequilíbrio real) pra uma análise de distribuição aqui.
        </p>
      </div>
    );
  }

  return <ExcessoDistribuicaoSection dados={excesso} distribuicaoHref={distribuicaoHref} />;
}
