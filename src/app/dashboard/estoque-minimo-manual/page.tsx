import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getEstoqueMinimoManual, getDistinctTamanhos } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { StatTile } from "../stat-tile";
import { EstoqueMinimoManualFiltros } from "./filtros";
import { ProdutosConsolidadoTable } from "./produtos-table";

const BASE_PATH = "/dashboard/estoque-minimo-manual";

// Estoque Mínimo MANUAL por SKU (pedido do Rodrigo, 2026-11-18 — generaliza
// docs/planejamento-inteligente-estoque.md §19, que começou restrito a Best Seller). Mesmo padrão
// de sessão/permissão de estoque-minimo/page.tsx (StockMinimumRule, OUTRA tela, por LOJA
// individual — este aqui é da EMPRESA, por cod = produto+cor+tamanho, somando todas as posições,
// e vale pra QUALQUER SKU — classificado como Best Seller/Drop ou não).
//
// Redesenho (2026-11-24, achado real: Rodrigo não conseguia achar onde editar o mínimo) — antes
// exigia clicar num produto, navegar via querystring ?produto=, e rolar até uma tabela de detalhe
// separada pra só então achar o campo de edição. Agora produtos-table.tsx expande tudo inline
// (<details>, mesmo padrão de distribuicao-table.tsx) com o campo de edição direto na linha do
// tamanho — não precisa mais de navegação nem de ProdutoDetalhe separado.
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

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Estoque Mínimo Manual</h1>
      <p className="mb-4 max-w-4xl text-sm text-[var(--text-secondary)]">
        Mínimo que a <strong>empresa</strong> decidiu manter de cada SKU (produto+cor+tamanho), somando TODAS as
        lojas + CD/Site — nunca avaliado loja a loja, e um SKU com sobra nunca compensa outro em falta (ex: 272
        unidades do tamanho 42 não cobrem o 36 ter só 34). Vale pra qualquer SKU — Best Seller, Drop ou sem
        classificação — o valor é sempre definido manualmente por você, nunca estimado pelo sistema. Não é a mesma
        coisa que a aba &quot;Estoque Mínimo&quot; existente (aquela é por loja individual, não da empresa toda).
        {podeEditar && (
          <> <strong>Clique num produto abaixo pra abrir e editar o mínimo de cada tamanho direto na linha.</strong></>
        )}
      </p>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Tamanhos no filtro" value={totalTamanhos.toLocaleString("pt-BR")} />
        <StatTile label="Crítico" value={criticos.toLocaleString("pt-BR")} status={criticos > 0 ? "critical" : "good"} />
        <StatTile label="Atenção" value={atencoes.toLocaleString("pt-BR")} status={atencoes > 0 ? "warning" : "good"} />
        <StatTile label="Sem mínimo definido" value={semMinimo.toLocaleString("pt-BR")} />
      </section>

      <EstoqueMinimoManualFiltros basePath={BASE_PATH} tamanhos={tamanhos} value={{ tamanhoIn: tamanhoFiltro, busca }} />

      <ProdutosConsolidadoTable itens={itens} podeEditar={podeEditar} />
    </div>
  );
}
