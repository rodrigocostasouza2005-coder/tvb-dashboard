import { normalizarChave } from "./normalizacao-texto";

/**
 * Capitais dos 26 estados + Distrito Federal — usado pela cota geográfica de prospecção
 * (ver quota-geografica.ts). Verificado que não existia nenhum mapa UF→capital no repositório
 * antes deste rebuild (busca por "capital" em src/ não retornou nenhum candidato equivalente).
 * Fonte: divisão político-administrativa oficial do IBGE (não muda com frequência: a última
 * criação/mudança de capital estadual foi Palmas/TO em 1990).
 */
export const CAPITAIS_ESTADUAIS: Record<string, string> = {
  AC: "Rio Branco",
  AL: "Maceió",
  AP: "Macapá",
  AM: "Manaus",
  BA: "Salvador",
  CE: "Fortaleza",
  DF: "Brasília",
  ES: "Vitória",
  GO: "Goiânia",
  MA: "São Luís",
  MT: "Cuiabá",
  MS: "Campo Grande",
  MG: "Belo Horizonte",
  PA: "Belém",
  PB: "João Pessoa",
  PR: "Curitiba",
  PE: "Recife",
  PI: "Teresina",
  RJ: "Rio de Janeiro",
  RN: "Natal",
  RS: "Porto Alegre",
  RO: "Porto Velho",
  RR: "Boa Vista",
  SC: "Florianópolis",
  SP: "São Paulo",
  SE: "Aracaju",
  TO: "Palmas",
};

/** Útil pra validar entrada de UF nas funções públicas deste módulo e do motor de qualificação. */
export function ufValida(uf: string): boolean {
  return /^[A-Z]{2}$/.test(uf) && uf in CAPITAIS_ESTADUAIS;
}

/**
 * Compara município informado (ex: vindo da Receita Federal/Serpro, com variação de acento,
 * maiúscula ou "Rio de Janeiro" vs "RIO DE JANEIRO") contra a capital oficial daquela UF.
 * Retorna false (nunca lança) pra UF desconhecida ou município vazio — quem chama decide se
 * isso é erro de dado upstream; esta função só responde "é capital ou não".
 */
export function ehCapitalEstadual(uf: string, municipio: string | null | undefined): boolean {
  const sigla = uf.trim().toUpperCase();
  const capital = CAPITAIS_ESTADUAIS[sigla];
  if (!capital || !municipio?.trim()) return false;
  return normalizarChave(municipio) === normalizarChave(capital);
}
