import { describe, expect, it, vi } from "vitest";
import {
  importarComValidacaoUf,
  mapearSituacaoCadastralReceita,
  separarPorUfLitoranea,
  FONTE_SITUACAO_CADASTRAL_RECEITA_SNAPSHOT,
  type PersistenciaProspectosReceita,
  type RegistroReceita,
} from "./importador-receita";
import { avaliarEliminacao, type CandidatoProspect } from "./motor-elegibilidade";

function registro(cnpj: string, uf: string): RegistroReceita {
  return { cnpj, uf };
}

function persistenciaMock(existentes: Set<string> = new Set()): PersistenciaProspectosReceita<RegistroReceita> {
  return {
    buscarCnpjsExistentes: vi.fn(async (cnpjs: string[]) => new Set(cnpjs.filter((c) => existentes.has(c)))),
    inserirLote: vi.fn(async (registros: RegistroReceita[]) => registros.length),
  };
}

describe("separarPorUfLitoranea", () => {
  it("aceita UF litorânea", () => {
    const { aceitos, rejeitados } = separarPorUfLitoranea([registro("11222333000181", "RJ")]);
    expect(aceitos).toHaveLength(1);
    expect(rejeitados).toHaveLength(0);
  });

  it("rejeita UF não litorânea", () => {
    const { aceitos, rejeitados } = separarPorUfLitoranea([registro("11222333000181", "MG")]);
    expect(aceitos).toHaveLength(0);
    expect(rejeitados).toHaveLength(1);
    expect(rejeitados[0].motivo).toContain("fora dos 17 estados litorâneos");
  });

  it("rejeita UF inválida/malformada (ausente, 1 letra, 3 letras, número, string vazia)", () => {
    const casos = [registro("a", ""), registro("b", "R"), registro("c", "RJX"), registro("d", "12")];
    const { aceitos, rejeitados } = separarPorUfLitoranea(casos);
    expect(aceitos).toHaveLength(0);
    expect(rejeitados).toHaveLength(4);
    expect(rejeitados.every((r) => r.motivo.includes("malformada") || r.motivo.includes("ausente") || r.motivo.includes("fora dos 17"))).toBe(true);
  });

  it("não muta o array de entrada", () => {
    const entrada = [registro("11222333000181", "rj")];
    const copia = JSON.parse(JSON.stringify(entrada));
    separarPorUfLitoranea(entrada);
    expect(entrada).toEqual(copia);
  });
});

describe("importarComValidacaoUf — dry-run (apply=false) nunca escreve", () => {
  it("não chama nenhum método de persistência, mesmo com registros válidos aceitos", async () => {
    const persistencia = persistenciaMock();
    const resumo = await importarComValidacaoUf({
      registros: [registro("11222333000181", "RJ"), registro("22333444000199", "SP")],
      apply: false,
      persistencia,
    });
    expect(persistencia.buscarCnpjsExistentes).not.toHaveBeenCalled();
    expect(persistencia.inserirLote).not.toHaveBeenCalled();
    expect(resumo.apply).toBe(false);
    expect(resumo.inseridos).toBe(0);
    expect(resumo.jaExistiam).toBe(0);
    expect(resumo.aceitosPorUf).toBe(2);
  });

  it("reporta rejeitados por UF mesmo em dry-run, sem persistir nada", async () => {
    const persistencia = persistenciaMock();
    const resumo = await importarComValidacaoUf({
      registros: [registro("11222333000181", "RJ"), registro("99888777000111", "MT")],
      apply: false,
      persistencia,
    });
    expect(resumo.rejeitadosPorUf).toEqual([{ cnpj: "99888777000111", uf: "MT", motivo: expect.stringContaining("fora dos 17") }]);
    expect(persistencia.inserirLote).not.toHaveBeenCalled();
  });
});

describe("importarComValidacaoUf — nenhum caminho alternativo contorna a validação de UF", () => {
  it("com apply=true, jamais passa um registro de UF não litorânea para inserirLote", async () => {
    const persistencia = persistenciaMock();
    await importarComValidacaoUf({
      registros: [
        registro("11222333000181", "RJ"),
        registro("55666777000122", "GO"), // não litorânea — nunca pode chegar em inserirLote
        registro("88999000000133", "SP"),
      ],
      apply: true,
      persistencia,
    });
    const chamadas = (persistencia.inserirLote as ReturnType<typeof vi.fn>).mock.calls as Array<[RegistroReceita[]]>;
    const todosRegistrosInseridos = chamadas.flatMap((chamada) => chamada[0]);
    expect(todosRegistrosInseridos.some((r) => r.uf === "GO")).toBe(false);
    expect(todosRegistrosInseridos.map((r) => r.cnpj).sort()).toEqual(["11222333000181", "88999000000133"]);
  });
});

describe("importarComValidacaoUf — duplicatas (idempotência)", () => {
  it("não insere de novo um CNPJ já existente, mas insere os novos do mesmo lote", async () => {
    const persistencia = persistenciaMock(new Set(["11222333000181"]));
    const resumo = await importarComValidacaoUf({
      registros: [registro("11222333000181", "RJ"), registro("22333444000199", "RJ")],
      apply: true,
      persistencia,
    });
    expect(persistencia.inserirLote).toHaveBeenCalledTimes(1);
    expect(persistencia.inserirLote).toHaveBeenCalledWith([registro("22333444000199", "RJ")]);
    expect(resumo.jaExistiam).toBe(1);
    expect(resumo.inseridos).toBe(1);
  });

  it("não chama inserirLote quando o lote inteiro já existe (evita escrita vazia/sobrescrita)", async () => {
    const persistencia = persistenciaMock(new Set(["11222333000181"]));
    const resumo = await importarComValidacaoUf({
      registros: [registro("11222333000181", "RJ")],
      apply: true,
      persistencia,
    });
    expect(persistencia.inserirLote).not.toHaveBeenCalled();
    expect(resumo.jaExistiam).toBe(1);
    expect(resumo.inseridos).toBe(0);
  });

  it("respeita o tamanho de lote configurado ao checar duplicatas e inserir", async () => {
    const persistencia = persistenciaMock();
    const registros = Array.from({ length: 5 }, (_, i) => registro(String(i).padStart(14, "1"), "RJ"));
    await importarComValidacaoUf({ registros, apply: true, persistencia, tamanhoLote: 2 });
    expect(persistencia.buscarCnpjsExistentes).toHaveBeenCalledTimes(3); // lotes de 2,2,1
  });
});

/**
 * Melhoria 1 (piloto RJ, nov/2026): situação cadastral via Receita Federal, sem Serpro. O gate do
 * motor (EXISTENCIA, motor-elegibilidade.ts) só avança de INCONCLUSIVO quando `situacaoCadastral`
 * está preenchido — até aqui só o Serpro preenchia esse campo, e o Rodrigo decidiu não contratar.
 * `mapearSituacaoCadastralReceita` é o núcleo testável que decodifica o código bruto da Receita
 * (exportado agora por extrair-parquet-receita.py) sem depender de rede nem Prisma.
 */
describe("mapearSituacaoCadastralReceita — nunca assume ATIVA por padrão", () => {
  it("decodifica os 5 códigos oficiais da Receita Federal", () => {
    expect(mapearSituacaoCadastralReceita("01")).toBe("NULA");
    expect(mapearSituacaoCadastralReceita("02")).toBe("ATIVA");
    expect(mapearSituacaoCadastralReceita("03")).toBe("SUSPENSA");
    expect(mapearSituacaoCadastralReceita("04")).toBe("INAPTA");
    expect(mapearSituacaoCadastralReceita("08")).toBe("BAIXADA");
  });

  it("código ausente/vazio/nulo vira NAO_INFORMADA — nunca ATIVA por padrão", () => {
    expect(mapearSituacaoCadastralReceita("")).toBe("NAO_INFORMADA");
    expect(mapearSituacaoCadastralReceita(null)).toBe("NAO_INFORMADA");
    expect(mapearSituacaoCadastralReceita(undefined)).toBe("NAO_INFORMADA");
    expect(mapearSituacaoCadastralReceita("   ")).toBe("NAO_INFORMADA");
  });

  it("código presente mas desconhecido vira DESCONHECIDA — nunca ATIVA por padrão", () => {
    expect(mapearSituacaoCadastralReceita("99")).toBe("DESCONHECIDA");
    expect(mapearSituacaoCadastralReceita("2")).toBe("DESCONHECIDA"); // sem zero à esquerda não é o código oficial de 2 dígitos
  });
});

describe("Melhoria 1 — situação cadastral da Receita destrava o critério EXISTENCIA sem Serpro", () => {
  const CNPJ_VALIDO = "11222333000181";

  function candidatoComSituacao(codigoBruto: string): CandidatoProspect {
    return {
      nomeFantasia: "Loja Teste",
      cnpj: CNPJ_VALIDO,
      situacaoCadastral: mapearSituacaoCadastralReceita(codigoBruto),
      categoriasBloqueio: [],
      evidenciaExistencia: [
        { descricao: "CNPJ válido e contato cadastral presente na base pública da Receita Federal.", fonteUrl: null, dataVerificacao: new Date("2026-11-01") },
      ],
      evidenciaAtividadeComercial: [],
      evidenciaVarejoVestuario: [],
      evidenciaModaMasculina: [],
      marcas: [],
      evidenciaPosicionamentoTvb: [],
    };
  }

  it("situação ativa ('02') na extração: situacaoCadastral populado e critério EXISTENCIA passa, mesmo sem nenhuma consulta Serpro", () => {
    const candidato = candidatoComSituacao("02");
    expect(candidato.situacaoCadastral).toBe("ATIVA");
    const resultado = avaliarEliminacao(candidato);
    expect(resultado.criterios.find((c) => c.id === "EXISTENCIA")?.resultado).toBe("ATENDE");
  });

  it.each(["03", "04", "08"])("situação '%s' (suspensa/inapta/baixada): critério EXISTENCIA não passa (INCONCLUSIVO, nunca ATENDE)", (codigo) => {
    const candidato = candidatoComSituacao(codigo);
    const resultado = avaliarEliminacao(candidato);
    const existencia = resultado.criterios.find((c) => c.id === "EXISTENCIA");
    expect(existencia?.resultado).not.toBe("ATENDE");
  });

  it("código ausente (CSV sem a coluna): situacaoCadastral fica NAO_INFORMADA e EXISTENCIA permanece INCONCLUSIVO (comportamento anterior preservado)", () => {
    const candidato = candidatoComSituacao("");
    expect(candidato.situacaoCadastral).toBe("NAO_INFORMADA");
    const resultado = avaliarEliminacao(candidato);
    expect(resultado.criterios.find((c) => c.id === "EXISTENCIA")?.resultado).toBe("INCONCLUSIVO");
  });

  it("marcador de confiança é distinto do Serpro (nunca grava CADASTRAL_OFICIAL para um snapshot mensal)", () => {
    expect(FONTE_SITUACAO_CADASTRAL_RECEITA_SNAPSHOT).toBe("CADASTRAL_RECEITA_SNAPSHOT");
    expect(FONTE_SITUACAO_CADASTRAL_RECEITA_SNAPSHOT).not.toBe("CADASTRAL_OFICIAL");
  });
});
