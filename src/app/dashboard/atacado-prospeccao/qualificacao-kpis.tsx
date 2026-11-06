import { StatTile } from "../stat-tile";
import type { ContagemStatusComercial } from "@/lib/metrics/prospeccao-qualificacao";

// KPIs da decisão do motor (statusComercial), reaproveitando o StatTile usado no resto do Radar
// — nada de grid decorativo próprio, nada de grupo A/B/C/D (substituído aqui na faxina pós-
// auditoria; esse campo nunca é gravado com A/B/C/D em produção, só "PENDENTE").
//
// São 5 blocos pros 6 estados comerciais reais pedidos na auditoria: "aprovado manualmente",
// "pendente de revisão humana" e "reprovado" mapeiam 1:1 pro enum StatusComercialProspect.
// "Aguardando investigação" e "em investigação"/"evidências insuficientes" NÃO têm 4 valores
// distintos no schema — StatusComercialProspect só tem UM EM_INVESTIGACAO pros dois primeiros, e
// "evidências insuficientes" não é um status próprio, é o que resultadoEliminacao=INCONCLUSIVO
// já significa (ver contarPorStatusComercial em prospeccao-qualificacao.ts). Por isso "em
// investigação" e "evidências insuficientes" aparecem juntos no mesmo bloco — não é um status
// novo, é leitura honesta do campo que já existe.
export function QualificacaoKpis({ contagem }: { contagem: ContagemStatusComercial }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <StatTile
        label="APROVADOS (MANUAL)"
        value={contagem.aprovado.toLocaleString("pt-BR")}
        subValue={`${contagem.altaPrioridade.toLocaleString("pt-BR")} alta prioridade · ${contagem.qualificado.toLocaleString("pt-BR")} qualificados`}
        status={contagem.aprovado > 0 ? "good" : undefined}
      />
      <StatTile
        label="PENDENTES DE REVISÃO HUMANA"
        value={contagem.pendente.toLocaleString("pt-BR")}
        subValue="Aguardando decisão humana"
        status={contagem.pendente > 0 ? "warning" : undefined}
      />
      <StatTile
        label="AGUARDANDO INVESTIGAÇÃO"
        value={contagem.aguardandoInvestigacao.toLocaleString("pt-BR")}
        subValue="Motor ainda não rodou sobre este prospect"
      />
      <StatTile
        label="EM INVESTIGAÇÃO (EVIDÊNCIA INSUFICIENTE)"
        value={contagem.emInvestigacaoComEvidenciaInsuficiente.toLocaleString("pt-BR")}
        subValue="Gate rodou, nada bloqueou, falta evidência em algum critério"
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
