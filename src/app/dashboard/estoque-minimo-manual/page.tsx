import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getEstoqueMinimoManual, getDistinctTamanhos } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { StatTile } from "../stat-tile";
import { EstoqueMinimoManualFiltros } from "./filtros";
import { ProdutosConsolidadoTable } from "./produtos-table";
import { ProdutoDetalhe } from "./produto-detalhe";

const BASE_PATH = "/dashboard/estoque-minimo-manual";

// Estoque Mínimo MANUAL por SKU (pedido do Rodrigo, 2026-11-18 — generaliza
// docs/planejamento-inteligente-estoque.md §19, que começou restrito a Best Seller). Mesmo padrão
// de sessão/permissão de estoque-minimo/page.tsx (StockMinimumRule, OUTRA tela, por LOJA
// individual — este aqui é da EMPRESA, por cod = produto+cor+tamanho, somando todas as posições,
// e vale pra QUALQUER SKU — classificado como Best Seller/Drop ou não).
export default async function EstoqueMinimoManualPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "estoque-minimo-manual");
  if (user.role === "VENDEDOR") redirect("/dashboard");

  const rawParams = await searchParams;
  const tamanhoFiltro = toArray(rawParams.tamanho);
  const busca = typeof rawParams.busca === "string" ? rawParams.busca : "";
  const produtoAberto = typeof rawParams.produto === "string" ? rawParams.produto : undefined;

  const grupoRestricao = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);

  const filtro = {
    grupoIn: grupoRestricao,
    tamanhoIn: tamanhoFiltro.length > 0 ? tamanhoFiltro : undefined,
    busca: busca.trim() || undefined,
    storeIdsPermitidas: allowedStores,
  };

  const [tamanhos, itens] = await Promise.all([getDistinctTamanhos(), getEstoqueMinimoManual(filtro)]);

  // Mesma régua de permissão de atualizarEstoqueMinimoManualAction (classificacao-actions.ts)
  // — a UI só mostra o formulário de edição pra quem a server action aceitaria de qualquer forma.
  const podeEditar = user.role === "ADMIN" || user.role === "GESTAO";

  const totalTamanhos = itens.length;
  const criticos = itens.filter((i) => i.nivelAlerta === "CRITICO").length;
  const atencoes = itens.filter((i) => i.nivelAlerta === "ATENCAO").length;
  const semMinimo = itens.filter((i) => i.nivelAlerta === "SEM_MINIMO_DEFINIDO").length;

  const queryParams = new URLSearchParams();
  for (const t of tamanhoFiltro) queryParams.append("tamanho", t);
  if (busca.trim()) queryParams.set("busca", busca.trim());
  const queryString = queryParams.toString();
  const fecharHref = queryString ? `${BASE_PATH}?${queryString}` : BASE_PATH;

  const itensDoProdutoAberto = produtoAberto ? itens.filter((i) => i.produto === produtoAberto) : [];

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Estoque Mínimo Manual</h1>
      <p className="mb-4 max-w-4xl text-sm text-[var(--text-secondary)]">
        Mínimo que a <strong>empresa</strong> decidiu manter de cada SKU (produto+cor+tamanho), somando TODAS as
        lojas + CD/Site — nunca avaliado loja a loja, e um SKU com sobra nunca compensa outro em falta (ex: 272
        unidades do tamanho 42 não cobrem o 36 ter só 34). Vale pra qualquer SKU — Best Seller, Drop ou sem
        classificação — o valor é sempre definido manualmente por você, nunca estimado pelo sistema. Não é a mesma
        coisa que a aba &quot;Estoque Mínimo&quot; existente (aquela é por loja individual, não da empresa toda).
      </p>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Tamanhos no filtro" value={totalTamanhos.toLocaleString("pt-BR")} />
        <StatTile label="Crítico" value={criticos.toLocaleString("pt-BR")} status={criticos > 0 ? "critical" : "good"} />
        <StatTile label="Atenção" value={atencoes.toLocaleString("pt-BR")} status={atencoes > 0 ? "warning" : "good"} />
        <StatTile label="Sem mínimo definido" value={semMinimo.toLocaleString("pt-BR")} />
      </section>

      <EstoqueMinimoManualFiltros basePath={BASE_PATH} tamanhos={tamanhos} value={{ tamanhoIn: tamanhoFiltro, busca }} />

      {produtoAberto && (
        <ProdutoDetalhe produto={produtoAberto} itens={itensDoProdutoAberto} podeEditar={podeEditar} fecharHref={fecharHref} />
      )}

      <ProdutosConsolidadoTable itens={itens} basePath={BASE_PATH} queryString={queryString} produtoAberto={produtoAberto} />
    </div>
  );
}
