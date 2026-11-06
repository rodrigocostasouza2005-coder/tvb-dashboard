import { StatTile } from "../stat-tile";
import type { ContagemStatusComercial } from "@/lib/metrics/prospeccao-qualificacao";

// KPIs da decisão do motor (statusComercial), reaproveitando o StatTile usado no resto do Radar
// — nada de grid decorativo próprio. Só 4 números, cada um com aplicação prática direta (cada um
// corresponde a uma tabela/filtro clicável nesta mesma aba), sem indicador solto sem uso.
export function QualificacaoKpis({ contagem }: { contagem: ContagemStatusComercial }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile
        label="APROVADOS"
        value={contagem.aprovado.toLocaleString("pt-BR")}
        subValue={`${contagem.altaPrioridade.toLocaleString("pt-BR")} alta prioridade · ${contagem.qualificado.toLocaleString("pt-BR")} qualificados`}
        status={contagem.aprovado > 0 ? "good" : undefined}
      />
      <StatTile
        label="PENDENTES DE REVISÃO"
        value={contagem.pendente.toLocaleString("pt-BR")}
        subValue="Aguardando decisão humana"
        status={contagem.pendente > 0 ? "warning" : undefined}
      />
      <StatTile
        label="EM INVESTIGAÇÃO"
        value={contagem.emInvestigacao.toLocaleString("pt-BR")}
        subValue="Motor ainda coletando evidência"
      />
      <StatTile
        label="REPROVADOS"
        value={contagem.reprovado.toLocaleString("pt-BR")}
        subValue="Disponível para auditoria"
        status={contagem.reprovado > 0 ? "critical" : undefined}
      />
    </div>
  );
}
