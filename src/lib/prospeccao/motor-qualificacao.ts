import { avaliarEliminacao, type CandidatoProspect, type ResultadoEliminacao } from "./motor-elegibilidade";
import { PONTO_CORTE_APROVACAO, pontuarProspect, type ResultadoPontuacao } from "./motor-pontuacao";
import { normalizarChave } from "./normalizacao-texto";

/**
 * Orquestrador do núcleo de qualificação (rebuild Fase 1, 2026-11) — o único ponto de entrada
 * que um script/UI futuro deveria chamar. Garante a regra mais importante do pedido do Rodrigo:
 * "nenhum score salva quem falha num critério obrigatório" — score só é calculado depois do
 * gate aprovar, nunca antes, nunca em paralelo, nunca como tentativa de compensação.
 *
 * statusComercial é deliberadamente mais conservador que a classificação de qualidade: mesmo um
 * candidato ALTA_PRIORIDADE nunca sai daqui como APROVADO — vira PENDENTE_REVISAO_HUMANA. Só uma
 * pessoa promove pra APROVADO (ação manual, fora deste motor). Isso mantém a mesma filosofia que
 * já existia no pipeline anterior (agente-pesquisa-comercial.ts: "Grupo comercial permanece
 * PENDENTE até revisão humana... esta avaliação não aprova nem autoriza contato") — não é
 * regressão, é a mesma regra agora formalizada num tipo (StatusComercial) em vez de um comentário.
 *
 * Ponto de extensão pra auditoria adversarial (fase futura, NÃO implementada aqui): um agente
 * independente pode pegar qualquer prospect com statusComercial PENDENTE_REVISAO_HUMANA (ou já
 * APROVADO) e chamar avaliarEliminacao/pontuarProspect de novo com evidência nova, substituindo
 * o resultado anterior — nenhuma mudança de schema é necessária pra isso, os mesmos campos
 * (resultadoEliminacao, scoreDetalhe, statusComercial) são reescritos. Ver schema.prisma,
 * comentário no model AtacadoProspect, pros campos `revisaoAdversarial*`.
 */

export type StatusComercial = "APROVADO" | "EM_INVESTIGACAO" | "REPROVADO" | "PENDENTE_REVISAO_HUMANA";

export type EntradaQualificacao = CandidatoProspect & {
  fontesOficiaisConsultadas: boolean;
  fontesMultiplas: boolean;
  informacaoAtualizada: boolean;
  potencialComercialSinais: Array<{ descricao: string }>;
};

export type ResultadoQualificacao = {
  eliminacao: ResultadoEliminacao;
  /** null sempre que o gate não retornou APROVADO_GATE — nunca existe pontuação "parcial". */
  pontuacao: ResultadoPontuacao | null;
  statusComercial: StatusComercial;
  motivo: string;
};

/**
 * Função central do motor. Único caminho que produz um ResultadoQualificacao — nunca chamar
 * avaliarEliminacao/pontuarProspect soltos fora daqui num fluxo real, exatamente pra não abrir
 * brecha de "pontuar mesmo reprovado por engano".
 */
export function qualificarProspect(candidato: EntradaQualificacao): ResultadoQualificacao {
  const eliminacao = avaliarEliminacao(candidato);

  if (eliminacao.resultado === "REPROVADO") {
    return {
      eliminacao,
      pontuacao: null,
      statusComercial: "REPROVADO",
      motivo: `Reprovado no gate de elegibilidade: ${eliminacao.motivosReprovacao.join("; ")}`,
    };
  }

  if (eliminacao.resultado === "INCONCLUSIVO") {
    return {
      eliminacao,
      pontuacao: null,
      statusComercial: "EM_INVESTIGACAO",
      motivo: "Gate de elegibilidade inconclusivo: falta evidência em ao menos um critério obrigatório antes de pontuar.",
    };
  }

  // Só chega aqui com eliminacao.resultado === "APROVADO_GATE".
  const pontuacao = pontuarProspect(candidato);
  const statusComercial: StatusComercial = pontuacao.classificacao === "REPROVADO" ? "REPROVADO" : "PENDENTE_REVISAO_HUMANA";
  const motivo = pontuacao.classificacao === "REPROVADO"
    ? `Passou no gate de elegibilidade, mas pontuação ${pontuacao.total}/100 está abaixo do corte mínimo de aprovação (${PONTO_CORTE_APROVACAO}).`
    : `Passou no gate de elegibilidade com pontuação ${pontuacao.total}/100 (${pontuacao.classificacao}); aguardando revisão humana antes de entrar na base comercial definitiva.`;

  return { eliminacao, pontuacao, statusComercial, motivo };
}

export type SinalDuplicata = {
  tipo: "CNPJ" | "NOME_MESMO_MUNICIPIO" | "ENDERECO";
  descricao: string;
};

export type CandidatoDedup = {
  id: string;
  cnpj: string | null;
  cnpjRaiz: string | null;
  nomeFantasia: string;
  cidade: string | null;
  estado: string | null;
  enderecoOficial: string | null;
};

/**
 * Detecção de possível duplicata — não é um constraint de banco (ver comentário no
 * schema.prisma sobre por que nome/endereço não podem ser UNIQUE: filiais legítimas da mesma
 * rede compartilham nome entre cidades diferentes de propósito). Esta função serve pra alimentar
 * uma fila de revisão humana, nunca pra bloquear automaticamente um insert. matriz/filial do
 * mesmo cnpjRaiz NÃO é reportado como duplicata aqui — são oportunidades comerciais
 * potencialmente independentes (ver TipoEstabelecimento no schema); duplicata real é
 * nome+município repetido ou endereço repetido, que SIM merece checagem humana.
 */
export function detectarPossivelDuplicata(candidato: CandidatoDedup, existentes: CandidatoDedup[]): SinalDuplicata[] {
  const sinais: SinalDuplicata[] = [];
  const nomeChave = normalizarChave(candidato.nomeFantasia);
  const enderecoChave = candidato.enderecoOficial ? normalizarChave(candidato.enderecoOficial) : null;

  for (const outro of existentes) {
    if (outro.id === candidato.id) continue;

    if (candidato.cnpj && outro.cnpj && candidato.cnpj === outro.cnpj) {
      sinais.push({ tipo: "CNPJ", descricao: `Mesmo CNPJ já cadastrado em ${outro.id}.` });
      continue;
    }

    const mesmoMunicipio = candidato.estado === outro.estado && candidato.cidade === outro.cidade;
    if (mesmoMunicipio && nomeChave === normalizarChave(outro.nomeFantasia)) {
      sinais.push({ tipo: "NOME_MESMO_MUNICIPIO", descricao: `Nome fantasia igual no mesmo município de ${outro.id} — confirmar se não é o mesmo estabelecimento.` });
    }

    if (enderecoChave && outro.enderecoOficial && enderecoChave === normalizarChave(outro.enderecoOficial)) {
      sinais.push({ tipo: "ENDERECO", descricao: `Mesmo endereço oficial de ${outro.id}.` });
    }
  }

  return sinais;
}
