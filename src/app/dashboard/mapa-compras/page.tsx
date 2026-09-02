import { getSessionUser } from "@/lib/auth";
import { getMapaDeComprasDetalhado } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import { MapaComprasGrid } from "./mapa-compras-grid";

export default async function MapaComprasPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "mapa-compras");

  const grupoIn = await getGrupoRestriction(user.role);
  const grupos = await getMapaDeComprasDetalhado({ grupoIn });

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Razão de estoque mês a mês por grupo (clique pra abrir os produtos): Estoque inicial +
        Recebimento (produção) − Vendas − Bonificações = Estoque final, que vira o inicial do mês
        seguinte. Colunas com fundo azulado são <strong>projetadas</strong> (vendas planejadas =
        média líquida dos últimos 3 meses ajustada pela tendência recente); o resto é{" "}
        <strong>realizado</strong>, reconstruído a partir do estoque atual andando pra trás até
        set/2025 (não é dado gravado historicamente — é a matemática de conservação de estoque, já
        que o snapshot só guarda o valor de agora). Estoque ideal = vendas projetadas × cobertura
        (meses, editável por grupo). Falta comprar nos meses futuros considera que NADA é comprado
        (recebimento futuro = 0) — de propósito, pra mostrar o tamanho real do buraco se não agir;
        por isso o número cresce mês a mês e o estoque pode até ficar negativo lá na frente.
      </p>
      <p className="mb-4 text-xs text-[var(--text-muted)]">
        Atenção: "Recebimento" só enxerga produção interna (ordem de produção). Grupo que entra em
        estoque de outro jeito (ex: comprado pronto de fornecedor) pode mostrar estoque reconstruído
        negativo lá no passado — os meses mais recentes (perto de hoje) são os mais confiáveis, já
        que partem direto do estoque real atual.
      </p>

      <MapaComprasGrid grupos={grupos} />
    </div>
  );
}
