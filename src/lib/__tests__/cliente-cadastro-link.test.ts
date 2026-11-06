import { describe, it, expect } from "vitest";
import {
  buildClienteCadastroIndex,
  normalizarNomeCliente,
  resolverClienteCadastro,
  type ClienteCadastroCandidato,
} from "../cliente-cadastro-link";

const CANDIDATOS: ClienteCadastroCandidato[] = [
  { id: "c1", dapicId: 101, nome: "Maria Silva" },
  { id: "c2", dapicId: 202, nome: "João Souza" },
  // Homônimo real: dois dapicId distintos com o mesmo nome normalizado.
  { id: "c3", dapicId: 303, nome: "Carlos Pereira" },
  { id: "c4", dapicId: 404, nome: "carlos pereira" },
];

describe("normalizarNomeCliente", () => {
  it("remove espaço nas pontas e padroniza em caixa alta", () => {
    expect(normalizarNomeCliente("  Maria Silva  ")).toBe("MARIA SILVA");
  });
});

describe("resolverClienteCadastro", () => {
  const index = buildClienteCadastroIndex(CANDIDATOS);

  it("resolve por dapicIdCliente quando bate com um ClienteCadastro conhecido -> confianca ID", () => {
    const r = resolverClienteCadastro({ dapicIdCliente: 101, clienteNome: "Maria Silva" }, index);
    expect(r).toEqual({ clienteCadastroId: "c1", confianca: "ID" });
  });

  it("prioriza ID sobre nome mesmo se o nome também bateria sozinho", () => {
    const r = resolverClienteCadastro({ dapicIdCliente: 202, clienteNome: "Nome Divergente Qualquer" }, index);
    expect(r).toEqual({ clienteCadastroId: "c2", confianca: "ID" });
  });

  it("cai pro nome quando não há dapicIdCliente (fonte sem identificador, ex: /vendaspdv)", () => {
    const r = resolverClienteCadastro({ dapicIdCliente: null, clienteNome: "João Souza" }, index);
    expect(r).toEqual({ clienteCadastroId: "c2", confianca: "NOME" });
  });

  it("cai pro nome quando dapicIdCliente não bate com nenhum ClienteCadastro conhecido", () => {
    const r = resolverClienteCadastro({ dapicIdCliente: 999, clienteNome: "João Souza" }, index);
    expect(r).toEqual({ clienteCadastroId: "c2", confianca: "NOME" });
  });

  it("casa nome ignorando variação de capitalização/espaço", () => {
    const r = resolverClienteCadastro({ clienteNome: "  maria silva  " }, index);
    expect(r).toEqual({ clienteCadastroId: "c1", confianca: "NOME" });
  });

  it("homônimo real (2+ ClienteCadastro com o mesmo nome normalizado) -> null, nunca escolhe um a esmo", () => {
    const r = resolverClienteCadastro({ clienteNome: "Carlos Pereira" }, index);
    expect(r).toBeNull();
  });

  it("sem clienteNome e sem dapicIdCliente resolvível -> null", () => {
    expect(resolverClienteCadastro({}, index)).toBeNull();
    expect(resolverClienteCadastro({ dapicIdCliente: 999 }, index)).toBeNull();
  });

  it("clienteNome vazio/só espaço -> null, nunca trata como match", () => {
    expect(resolverClienteCadastro({ clienteNome: "   " }, index)).toBeNull();
  });

  it("nome sem nenhum ClienteCadastro correspondente -> null", () => {
    expect(resolverClienteCadastro({ clienteNome: "Cliente Desconhecido Ltda" }, index)).toBeNull();
  });
});

describe("buildClienteCadastroIndex", () => {
  it("agrupa candidatos com o mesmo nome normalizado na mesma entrada (sinal de homônimo)", () => {
    const index = buildClienteCadastroIndex(CANDIDATOS);
    expect(index.porNomeNormalizado.get("CARLOS PEREIRA")?.length).toBe(2);
  });

  it("indexa por dapicId pra lookup O(1)", () => {
    const index = buildClienteCadastroIndex(CANDIDATOS);
    expect(index.porDapicId.get(303)?.id).toBe("c3");
  });
});
