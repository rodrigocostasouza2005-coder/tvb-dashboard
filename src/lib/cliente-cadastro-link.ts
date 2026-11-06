// Resolução Sale/Gift -> ClienteCadastro (missão "ligue venda com cadastro", 2026-11-06).
//
// Por que existe: até esta migration, "é o mesmo cliente" em qualquer lugar do Radar (CAC,
// novo-vs-recorrente, Ficha do Cliente) era decidido comparando Sale.clienteNome (texto livre)
// normalizado (trim+upper) contra ClienteCadastro.nome — nunca por um identificador de verdade.
// Dois clientes reais com o mesmo nome digitado no DAPIC (homônimo) eram tratados como 1 só. Ver
// metrics/cac.ts (montarMotivoLimitacao) pro impacto concreto disso no CAC de e-commerce.
//
// O que mudou: investigação do conector (src/lib/connectors/dapic.ts) confirmou que a API do
// DAPIC NUNCA expõe CPF/CNPJ diretamente em /vendaspdv nem em /faturas (lista ou detalhe) — só em
// /clientes (DapicCliente.CpfCnpj, já capturado em ClienteCadastro.cpfCnpj). Mas /faturas EXPÕE
// "IdCliente" (DapicFatura.IdCliente) — o Id do cliente no MESMO espaço de /clientes, ou seja, já
// bate 1:1 com ClienteCadastro.dapicId. Isso não era capturado até aqui. Esse Id é MAIS forte que
// casar por CPF (nenhuma comparação de string, nenhuma ambiguidade de formatação) — por isso os
// dois níveis de confiança abaixo se chamam ID e NOME, não CPF e NOME (ver enum
// ClienteCadastroMatchConfianca no schema.prisma pra essa mesma explicação do lado do banco).
//
// /vendaspdv (loja física: Leblon/Rio Sul/Barra, e a devolução do token cd-atacado) nunca expõe
// NENHUM identificador de cliente — só o nome em texto livre (DapicVendaPdv.Cliente). Pra essas
// vendas, o nível ID nunca é alcançável a partir da API — NOME (a mesma limitação de sempre) é o
// melhor disponível, e é isso que esta função devolve quando só há nome pra comparar.
//
// Funções aqui são PURAS — nenhuma chamada a banco/API. Quem chama (sync-runner.ts,
// scripts/clientes/backfill-clientecadastro-link.ts) carrega os candidatos e constrói o índice.

export type ClienteCadastroCandidato = {
  id: string;
  dapicId: number;
  nome: string;
};

export type ClienteCadastroMatchConfianca = "ID" | "NOME";

export type ResolucaoClienteCadastro = {
  clienteCadastroId: string;
  confianca: ClienteCadastroMatchConfianca;
};

export type ClienteCadastroIndex = {
  porDapicId: Map<number, ClienteCadastroCandidato>;
  // Nome normalizado -> candidatos. Mais de 1 candidato pro mesmo nome normalizado = homônimo real
  // (dois dapicId distintos com o mesmo nome) — resolverClienteCadastro nunca escolhe um dos dois
  // a esmo, devolve null (ver comentário lá).
  porNomeNormalizado: Map<string, ClienteCadastroCandidato[]>;
};

export function normalizarNomeCliente(nome: string): string {
  return nome.trim().toUpperCase();
}

// Construído 1x por rodada de sync/backfill (não por linha de venda) — custo O(n) nos candidatos,
// resolverClienteCadastro depois é O(1) por venda em vez de escanear 26k+ linhas de ClienteCadastro
// a cada item.
export function buildClienteCadastroIndex(candidatos: ClienteCadastroCandidato[]): ClienteCadastroIndex {
  const porDapicId = new Map<number, ClienteCadastroCandidato>();
  const porNomeNormalizado = new Map<string, ClienteCadastroCandidato[]>();
  for (const c of candidatos) {
    porDapicId.set(c.dapicId, c);
    const norm = normalizarNomeCliente(c.nome);
    const lista = porNomeNormalizado.get(norm) ?? [];
    lista.push(c);
    porNomeNormalizado.set(norm, lista);
  }
  return { porDapicId, porNomeNormalizado };
}

export type VendaParaResolver = {
  // Id do cliente vindo direto da API (hoje só /faturas tem isso — fatura.IdCliente). Undefined/null
  // quando a fonte (ex: /vendaspdv) não carrega identificador nenhum.
  dapicIdCliente?: number | null;
  clienteNome?: string | null;
};

// Resolve uma venda a um ClienteCadastro, nessa ordem de confiança — NUNCA adivinha:
//   1. dapicIdCliente bate com um ClienteCadastro.dapicId conhecido -> confianca "ID".
//   2. Senão, clienteNome normalizado bate com EXATAMENTE 1 ClienteCadastro -> confianca "NOME".
//      Duas ou mais linhas de ClienteCadastro com o mesmo nome normalizado (homônimo real) ->
//      null, de propósito — escolher qualquer um dos dois seria inventar identidade.
//   3. Sem dapicIdCliente resolvível e sem nome (ou nome sem nenhum cadastro correspondente) ->
//      null.
export function resolverClienteCadastro(
  venda: VendaParaResolver,
  index: ClienteCadastroIndex
): ResolucaoClienteCadastro | null {
  if (venda.dapicIdCliente != null) {
    const porId = index.porDapicId.get(venda.dapicIdCliente);
    if (porId) return { clienteCadastroId: porId.id, confianca: "ID" };
  }

  if (!venda.clienteNome) return null;
  const norm = normalizarNomeCliente(venda.clienteNome);
  if (!norm) return null;
  const candidatos = index.porNomeNormalizado.get(norm);
  if (!candidatos || candidatos.length !== 1) return null;
  return { clienteCadastroId: candidatos[0].id, confianca: "NOME" };
}
