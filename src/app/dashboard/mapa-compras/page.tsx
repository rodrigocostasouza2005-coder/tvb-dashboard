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
        seguinte. Colunas com fundo azulado são <strong>projetadas</strong>; o resto é{" "}
        <strong>realizado</strong>, reconstruído a partir do estoque atual andando pra trás até
        set/2025 (não é dado gravado historicamente — é a matemática de conservação de estoque, já
        que o snapshot só guarda o valor de agora). Estoque ideal = vendas projetadas × cobertura
        (meses, editável por grupo). Falta comprar nos meses futuros considera que NADA é comprado
        (recebimento futuro = 0) — de propósito, pra mostrar o tamanho real do buraco se não agir.
      </p>
      <p className="mb-4 text-xs text-[var(--text-muted)]">
        Projeção com sazonalidade: pra cada mês futuro, calcula um índice sazonal por mês do
        calendário (ex: "Julho vende historicamente 40% acima da média desse grupo") a partir do
        único ano de histórico disponível, e aplica esse índice sobre o nível de tendência atual
        (últimos 3 meses, já descontada a própria sazonalidade deles). Um grupo que sempre vende
        mais no verão volta a projetar mais quando o mês futuro cair no verão, em vez de ficar preso
        no patamar do mês mais recente. Como só tem ~1 ano de histórico, o índice de cada mês vem de
        uma amostra só (não é uma média de vários anos) — mais confiável conforme o histórico
        crescer com o tempo.
      </p>
      <p className="mb-4 text-xs text-[var(--text-muted)]">
        Atenção: "Recebimento" só enxerga produção interna (ordem de produção) — o DAPIC não tem
        (ou eu ainda não achei) um endpoint de "compra de fornecedor" separado disso. Grupo que
        entra em estoque de outro jeito pode reconstruir estoque inicial NEGATIVO no passado — de
        propósito não escondemos isso mais (deixamos de travar em 0), porque esconder o número
        também escondia o problema real. Um negativo aqui é sinal de "recebimento que não estamos
        enxergando", não um erro de conta — os meses mais recentes (perto de hoje) são os mais
        confiáveis, já que partem direto do estoque real atual.
      </p>

      <MapaComprasGrid grupos={grupos} />
    </div>
  );
}
