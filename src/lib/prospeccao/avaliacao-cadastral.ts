export type ProspectoCadastral = {
  nomeFantasia: string;
  cnpj: string | null;
  cidade: string | null;
  estado: string | null;
  telefone: string | null;
  email: string | null;
  site: string | null;
  evidenciaUrl: string | null;
  observacoes: string | null;
};

export type AvaliacaoCadastral = {
  score: number;
  aptoParaFila: boolean;
  agente: "AGENTE_PESQUISA_TVB" | "AGENTE_VALIDACAO_TVB";
  motivo: string;
};

function cnpjValido(value: string | null): boolean {
  if (!value) return false;
  const cnpj = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj) || /^([A-Z0-9])\1{13}$/.test(cnpj)) return false;
  const calculate = (base: string, weights: number[]) => {
    const sum = [...base].reduce((total, char, index) => total + (char.charCodeAt(0) - 48) * weights[index], 0);
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };
  const first = calculate(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const second = calculate(cnpj.slice(0, 12) + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return cnpj.slice(-2) === first + second;
}

export function avaliarProspectoCadastral(prospect: ProspectoCadastral): AvaliacaoCadastral {
  const notes = prospect.observacoes ?? "";
  const cnaePrincipalModa = notes.includes("CNAE principal: 4781400");
  const nomeConhecido = Boolean(prospect.nomeFantasia.trim()) &&
    prospect.nomeFantasia !== "NOME COMERCIAL NÃO IDENTIFICADO";
  const hasContact = Boolean(prospect.telefone?.trim() || prospect.email?.trim());
  const validCnpj = cnpjValido(prospect.cnpj);
  const activeEvidence = notes.includes("Coleta cadastral Receita Federal");
  const score =
    (validCnpj ? 30 : 0) +
    (cnaePrincipalModa ? 25 : 0) +
    (nomeConhecido ? 20 : 0) +
    (prospect.cidade?.trim() ? 5 : 0) +
    (prospect.estado && /^[A-Z]{2}$/.test(prospect.estado) ? 5 : 0) +
    (prospect.telefone?.trim() ? 7 : 0) +
    (prospect.email?.trim() ? 5 : 0) +
    (prospect.site?.trim() ? 2 : 0) +
    (activeEvidence ? 1 : 0);

  const aptoParaFila = validCnpj && cnaePrincipalModa && nomeConhecido && hasContact;
  const agente = score >= 80 ? "AGENTE_VALIDACAO_TVB" : "AGENTE_PESQUISA_TVB";
  const motivo = [
    `Score cadastral ${score}/100 (completude/consistência, não potencial de compra)`,
    cnaePrincipalModa ? "CNAE principal de vestuário" : "CNAE principal não confirmado",
    nomeConhecido ? "nome fantasia informado na Receita" : "nome comercial precisa ser pesquisado",
    hasContact ? "há contato comercial cadastrado" : "falta contato comercial",
    "atividade ativa conforme dump cadastral; validar loja, multimarcas e moda masculina",
  ].join("; ");

  return { score, aptoParaFila, agente, motivo };
}
