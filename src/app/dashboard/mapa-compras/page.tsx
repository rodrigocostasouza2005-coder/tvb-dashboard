import { getSessionUser } from "@/lib/auth";
import { getMapaDeComprasDetalhado, getCrescimentoEsperado } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import { MapaComprasGrid } from "./mapa-compras-grid";
import { updateCrescimentoAction } from "./actions";

export default async function MapaComprasPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "mapa-compras");

  const grupoIn = await getGrupoRestriction(user.role);
  const [grupos, crescimentoPct] = await Promise.all([
    getMapaDeComprasDetalhado({ grupoIn }),
    getCrescimentoEsperado(),
  ]);

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Razão de estoque mês a mês por grupo (clique pra abrir os produtos): Estoque inicial +
        Recebimento − Vendas − Bonificações = Estoque final, que vira o inicial do mês seguinte —
        essa conta fecha exata em toda coluna, sem resto. Colunas com fundo azulado são{" "}
        <strong>projetadas</strong>; o resto é <strong>realizado</strong>, reconstruído a partir do
        estoque atual andando pra trás até set/2025 (não é dado gravado historicamente — é a
        matemática de conservação de estoque, já que o snapshot só guarda o valor de agora). Estoque
        nunca aparece negativo, porque fisicamente nunca foi (ver como isso é calculado no aviso
        abaixo). Estoque ideal = vendas projetadas × cobertura (meses, editável por grupo).
        "Cobertura (meses)" mostra quanto o estoque final do mês cobre de vendas — é derivado, não é
        uma previsão à parte. Nos meses futuros, "Recebimento" já inclui o "Falta comprar" do
        próprio mês — a projeção assume que você compra o recomendado na hora, então o estoque
        projetado nunca desaba: "Falta comprar" é a recomendação acumulada de quanto comprar em cada
        mês pra manter a cobertura, não um estoque que vai faltar de verdade se você seguir a
        recomendação.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--series-1)] bg-[var(--surface-1)] p-3">
        <form action={updateCrescimentoAction} className="flex items-center gap-2">
          <label className="text-sm text-[var(--text-secondary)]">Crescimento de receita esperado (ano vs. ano):</label>
          <input
            type="number"
            name="crescimentoPct"
            defaultValue={crescimentoPct}
            step={1}
            className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-right text-sm tabular-nums text-[var(--text-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">%</span>
          <button type="submit" className="rounded-md border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
            Salvar
          </button>
        </form>
        <p className="text-xs text-[var(--text-muted)]">
          Projeção por receita: receita de cada grupo no mesmo mês do ano anterior × (1 +
          crescimento acima), distribuída pra cada produto pela % de participação dele na receita
          do grupo no último mês completo, convertida pra unidades pelo preço médio de venda de
          cada produto (últimos 3 meses). Mesma lógica da sua planilha ("Crescimento do Ticket"
          aplicado sobre receita, ano contra ano) — você escolhe o número, não é calculado
          sozinho.
        </p>
      </div>

      <p className="mb-4 text-xs text-[var(--text-muted)]">
        Como funciona a conta de "Recebimento" nos meses realizados: parte da produção registrada
        numa ordem de produção (DAPIC) num mês não vira necessariamente estoque vendável NAQUELE
        mesmo mês (pode ter ido pro armazenador de defeito da loja, ficado retida em outra etapa,
        etc. — o DAPIC separa um "armazenador de defeitos" por loja, fora do estoque disponível).
        Quando a produção registrada de um mês é maior do que cabe pra fechar a conta (Estoque
        Inicial daria negativo), "Recebimento" mostra só o que efetivamente coube — nunca o número
        completo registrado, nem um número inventado maior que ele. Os meses mais recentes (perto
        de hoje) são os mais confiáveis, já que partem direto do estoque real atual. Bonificações
        (brindes) seguem só no histórico realizado — não são projetadas pra frente (fica 0 nos
        meses futuros).
      </p>

      <MapaComprasGrid grupos={grupos} />
    </div>
  );
}
