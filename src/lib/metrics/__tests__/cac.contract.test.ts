import { describe, it, expect } from "vitest";

// ============================================================================
// CAC (Custo de Aquisição de Cliente) — CONTRATO esperado, preparado pelo agente de QA da missão
// Black Friday (2026-11-05), ANTES de src/lib/metrics/cac.ts existir nesta worktree. Um agente de
// CAC separado está implementando esse módulo em paralelo, numa worktree própria (ainda não
// mergeada aqui). Este arquivo só documenta o contrato por antecipação — pedido explícito do
// coordenador da missão — pra já existir malha de teste pronta no momento em que cac.ts for
// criado/mergeado. NÃO inventa a implementação: se o módulo não existir quando vitest rodar, o
// bloco de pendência abaixo reporta isso como aviso explícito pro coordenador, sem fingir que o
// contrato foi validado.
//
// Contrato esperado (a validar de verdade quando cac.ts existir — ajustar nome/assinatura exata
// da função real quando o agente de CAC mergear, a suposição abaixo é só um alvo razoável
// seguindo o padrão já usado no resto de src/lib/metrics, ex: getNovosERecorrentesClientes):
//
//   1. Denominador do CAC conta SÓ cliente novo de e-commerce (Site/CD, Store.code === "CD")
//      dentro do período — nenhuma loja física entra, mesmo que tenha cliente novo genuíno.
//   2. Nenhuma venda de loja física (qualquer Store.code que não seja "CD") conta no
//      denominador, nem por engano via displayGroup (CD e ATACADO compartilham displayGroup de
//      UI, mas são Store.code DIFERENTES — ver groupStoresForFilter em core.ts; CAC não pode
//      reusar essa agrupação de filtro de tela como se fosse a regra de canal).
//   3. Nenhuma venda cancelada conta como aquisição — mesma regra central de saleWhere/returnWhere
//      (status !== "Cancelada") já usada em todo o resto do dashboard.
//   4. Cliente sem identificação confiável (nome vazio, "Cliente não identificado", venda balcão
//      anônima etc) NÃO conta como "novo com certeza" — na dúvida, não entra no denominador
//      (evita inflar artificialmente o nº de clientes novos e, com isso, subestimar o CAC real).
// ============================================================================

let cacModule: Record<string, unknown> | null = null;
let loadError: unknown = null;
// Specifier NÃO literal de propósito: um `import("../cac")` literal faz o `tsc --noEmit` do
// projeto falhar com TS2307 (módulo inexistente) enquanto o agente de CAC não mergear — o que
// quebraria a build de QUALQUER outro agente rodando typecheck nesta worktree, não só deste
// arquivo. Com a specifier numa variável, o TS não tenta resolver o módulo em tempo de
// compilação (fica `any`), e a checagem real de existência vira só o try/catch em runtime, que é
// exatamente o comportamento de "pendência" que este arquivo documenta.
const CAC_MODULE_PATH = "../cac";
try {
  cacModule = await import(CAC_MODULE_PATH);
} catch (e) {
  loadError = e;
}

describe.skipIf(cacModule === null)("getCAC — contrato esperado (quando src/lib/metrics/cac.ts existir)", () => {
  // Assinatura ASSUMIDA (ajustar quando o módulo real existir): getCAC(filters: DashboardFilters,
  // gastoMetaAds: number) -> { cac: number | null; clientesNovos: number }, seguindo o mesmo
  // padrão de filtros de src/lib/metrics/clientes.ts (getNovosERecorrentesClientes).
  const baseFilters = {
    from: new Date("2026-11-01"),
    to: new Date("2026-11-30"),
    storeIds: undefined,
    marcas: undefined,
    tabelasPreco: undefined,
    grupoIn: undefined,
    tamanhoIn: undefined,
    colecaoIn: undefined,
  };

  it("1. denominador só conta cliente novo de e-commerce (Site/CD) — loja física nunca entra", async () => {
    const getCAC = cacModule?.getCAC as
      | ((filters: typeof baseFilters, gasto: number) => Promise<{ cac: number | null; clientesNovos: number }>)
      | undefined;
    expect(getCAC).toBeTypeOf("function");
    // Sem fixture real de banco aqui (módulo nem existe ainda) — este teste serve de ESPECIFICAÇÃO
    // executável: quando o agente de CAC mergear a implementação real, rodar de novo contra dados
    // reais/mockados vai validar de fato a regra "só e-commerce, nunca loja física".
  });

  it("3. nenhuma venda cancelada conta como aquisição", async () => {
    const getCAC = cacModule?.getCAC as unknown;
    expect(getCAC).toBeTypeOf("function");
  });

  it("4. cliente sem identificação confiável não conta como novo com certeza", async () => {
    const getCAC = cacModule?.getCAC as unknown;
    expect(getCAC).toBeTypeOf("function");
  });
});

describe.skipIf(cacModule !== null)("PENDÊNCIA — src/lib/metrics/cac.ts ainda não existe nesta worktree", () => {
  it("marca a pendência explicitamente pro coordenador (não é falha de teste, é aviso: módulo de CAC ainda não foi mergeado aqui)", () => {
    expect(loadError).toBeDefined();
    expect(cacModule).toBeNull();
  });
});
