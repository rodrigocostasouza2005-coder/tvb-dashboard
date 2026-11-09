import { isUfLitoranea } from "./estados-litoraneos";
import type { SituacaoCadastral } from "./motor-elegibilidade";

/**
 * Núcleo testável da importação nacional da Receita Federal pro Neon (unificação da ingestão,
 * Fase 2 da faxina pós-auditoria 2026-11 — ver docs/expansao-atacadista/PROSPECCAO_AUTOMATICA.md
 * e auditoria, achados B.3/E.7/D6). Fica em src/lib/prospeccao/ (sem Prisma, sem I/O de arquivo,
 * sem rede) de propósito, igual ao resto do motor — quem grava de fato
 * (scripts/prospeccao/importar-receita.ts) injeta a persistência real via `Persistencia` abaixo,
 * nunca o contrário. Isso é o que permite testar "dry-run nunca escreve" e "UF fora da cobertura
 * nunca entra" sem precisar de um banco de verdade nem mockar o PrismaClient inteiro.
 *
 * Antes desta faxina, SÓ este script escrevia prospects em massa no Neon e NENHUM caminho
 * validava UF litorânea antes de persistir (a validação só existia no caminho que nunca grava —
 * extrair-parquet-receita.py). Isso corrige isso: `separarPorUfLitoranea` é o único portão, usando
 * a mesma fonte de verdade (estados-litoraneos.ts) que a UI do mapa já usa.
 */

export type RegistroReceita = {
  cnpj: string;
  uf: string;
};

/**
 * Melhoria 1 (piloto RJ, nov/2026): o critério EXISTENCIA do motor (motor-elegibilidade.ts) só
 * sai de INCONCLUSIVO quando `situacaoCadastral` está preenchido — e até aqui SÓ o Serpro
 * preenchia esse campo, que o Rodrigo decidiu não contratar. Mas `extrair-parquet-receita.py` já
 * filtra por situação ativa ('02') direto na fonte (Receita Federal/dados abertos, dataset
 * `cnpjaberto`) antes de gerar qualquer candidato — esse dado só não era propagado pro prospect.
 * Este mapa decodifica o código bruto de 2 dígitos (ver layout oficial da Receita) pro mesmo tipo
 * `SituacaoCadastral` que o motor consome, usando a MESMA semântica de código->situação que
 * src/lib/prospeccao/consulta-cnpj-serpro.ts já usa pro Serpro (lá os códigos vêm sem zero à
 * esquerda; aqui vêm com — "02" e "2" significam a mesma coisa).
 *
 * Deliberadamente NUNCA assume "ATIVA" por padrão: código ausente/vazio vira NAO_INFORMADA,
 * código presente mas desconhecido vira DESCONHECIDA — só os 5 códigos oficiais abaixo decodificam
 * para um valor definitivo. Isso é o que impede qualquer bug futuro de inflar a confiança de um
 * cadastro que não foi de fato confirmado como ativo.
 */
const CODIGOS_SITUACAO_CADASTRAL_RECEITA: Record<string, SituacaoCadastral> = {
  "01": "NULA",
  "02": "ATIVA",
  "03": "SUSPENSA",
  "04": "INAPTA",
  "08": "BAIXADA",
};

export function mapearSituacaoCadastralReceita(codigoBruto: string | null | undefined): SituacaoCadastral {
  const codigo = (codigoBruto ?? "").trim();
  if (!codigo) return "NAO_INFORMADA";
  return CODIGOS_SITUACAO_CADASTRAL_RECEITA[codigo] ?? "DESCONHECIDA";
}

/**
 * Marcador gravado em `AtacadoProspect.confiancaPesquisa` quando `situacaoCadastral` vem do
 * snapshot mensal da Receita Federal (extração própria), nunca de consulta oficial Serpro em
 * tempo real. Deliberadamente distinto de "CADASTRAL_OFICIAL" (usado só por
 * scripts/prospeccao/consultar-cnpj-serpro.ts) — ver restrição do Rodrigo: não inflar a confiança
 * de um dado de competência passada como se fosse verificação em tempo real. Não existe campo de
 * confiança dedicado à identidade cadastral no schema (AtacadoProspect reaproveita
 * `confiancaPesquisa`, um campo de texto livre, pros dois casos); criar um campo novo exigiria
 * migration, fora do escopo autorizado desta mudança — ver limitação documentada no relatório.
 */
export const FONTE_SITUACAO_CADASTRAL_RECEITA_SNAPSHOT = "CADASTRAL_RECEITA_SNAPSHOT" as const;

export type RegistroRejeitado<T> = {
  registro: T;
  motivo: string;
};

export type ResultadoSeparacaoUf<T> = {
  aceitos: T[];
  rejeitados: RegistroRejeitado<T>[];
};

/**
 * Único portão de validação geográfica antes de qualquer persistência de prospect vindo da
 * Receita Federal. UF ausente, malformada (não bate `/^[A-Z]{2}$/` depois de normalizar) ou fora
 * dos 17 estados litorâneos é sempre rejeitada — nunca persistida, sempre com motivo explícito
 * pra log/relatório. Não muta os registros de entrada.
 */
export function separarPorUfLitoranea<T extends RegistroReceita>(registros: readonly T[]): ResultadoSeparacaoUf<T> {
  const aceitos: T[] = [];
  const rejeitados: RegistroRejeitado<T>[] = [];
  for (const registro of registros) {
    const ufBruta = registro.uf ?? "";
    const ufNormalizada = ufBruta.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(ufNormalizada)) {
      rejeitados.push({ registro, motivo: `UF ausente ou malformada: "${ufBruta}".` });
      continue;
    }
    if (!isUfLitoranea(ufNormalizada)) {
      rejeitados.push({ registro, motivo: `UF "${ufNormalizada}" fora dos 17 estados litorâneos autorizados.` });
      continue;
    }
    aceitos.push(registro);
  }
  return { aceitos, rejeitados };
}

/**
 * Contrato de persistência real — implementado só pelo script (Prisma de verdade). Nenhuma função
 * aqui é chamada quando `apply` é falso (ver `importarComValidacaoUf` abaixo): o dry-run nem monta
 * este objeto com clientes reais no caminho feliz do script, e mesmo que montasse, a orquestração
 * abaixo garante que nenhum método é invocado antes de `apply` ser verdadeiro.
 */
export type PersistenciaProspectosReceita<T extends RegistroReceita> = {
  /** Devolve o subconjunto de CNPJs (dentre os informados) que já existem no Neon. */
  buscarCnpjsExistentes: (cnpjs: string[]) => Promise<Set<string>>;
  /** Insere um lote de registros NOVOS (sem duplicar); devolve quantos foram efetivamente inseridos. */
  inserirLote: (registros: T[]) => Promise<number>;
};

export type ResumoImportacao = {
  totalInformado: number;
  aceitosPorUf: number;
  rejeitadosPorUf: Array<{ cnpj: string; uf: string; motivo: string }>;
  /** Só preenchido quando apply=true — em dry-run nada é persistido, logo nada é inserido/ignorado. */
  inseridos: number;
  jaExistiam: number;
  apply: boolean;
};

/**
 * Orquestra validação de UF + idempotência (skip de CNPJ já existente) + persistência em lotes.
 * `persistencia` só é chamada quando `apply` é `true` — dry-run SEMPRE para antes disso, então
 * mockar `persistencia` num teste com `apply: false` e esperar zero chamadas é uma asserção válida
 * sobre o comportamento real, não um detalhe de implementação do teste.
 */
export async function importarComValidacaoUf<T extends RegistroReceita>(params: {
  registros: readonly T[];
  apply: boolean;
  persistencia: PersistenciaProspectosReceita<T>;
  tamanhoLote?: number;
}): Promise<ResumoImportacao> {
  const { registros, apply, persistencia, tamanhoLote = 400 } = params;
  const { aceitos, rejeitados } = separarPorUfLitoranea(registros);
  const resumoRejeitados = rejeitados.map((r) => ({ cnpj: r.registro.cnpj, uf: r.registro.uf, motivo: r.motivo }));

  if (!apply) {
    return {
      totalInformado: registros.length,
      aceitosPorUf: aceitos.length,
      rejeitadosPorUf: resumoRejeitados,
      inseridos: 0,
      jaExistiam: 0,
      apply: false,
    };
  }

  let inseridos = 0;
  let jaExistiam = 0;
  for (let offset = 0; offset < aceitos.length; offset += tamanhoLote) {
    const lote = aceitos.slice(offset, offset + tamanhoLote);
    const existentes = await persistencia.buscarCnpjsExistentes(lote.map((r) => r.cnpj));
    const novos = lote.filter((r) => !existentes.has(r.cnpj));
    jaExistiam += lote.length - novos.length;
    if (novos.length === 0) continue;
    inseridos += await persistencia.inserirLote(novos);
  }

  return {
    totalInformado: registros.length,
    aceitosPorUf: aceitos.length,
    rejeitadosPorUf: resumoRejeitados,
    inseridos,
    jaExistiam,
    apply: true,
  };
}
