export type ResultadoComercial = "INTERESSADO" | "PEDIU_CATALOGO" | "PEDIU_PRECO" | "NEGOCIANDO" | "PEDIDO_REALIZADO" | "RECOMPRA" | "RECUSOU" | "SEM_ADERENCIA" | "DADOS_INVALIDOS" | "SEM_RESPOSTA" | "OUTRO" | null;

export type RegistroAprendizado = {
  prospectId: string;
  segmentoComercial: string | null;
  perfilLoja: string | null;
  faixaPreco: string | null;
  estado: string | null;
  status: string;
  resultado: ResultadoComercial;
};

export type PerfilAprendido = {
  chave: string;
  perfil: string;
  totalLojas: number;
  interacoesComSinal: number;
  sinaisPositivos: number;
  sinaisNegativos: number;
  emNegociacao: number;
  convertidasDapic: number;
  taxaSinalPositivo: number;
  taxaConversaoDapic: number;
  confianca: "BAIXA" | "MEDIA" | "ALTA";
  atributos: { segmentoComercial: string | null; perfilLoja: string | null; faixaPreco: string | null; estado: string | null };
};

const POSITIVOS = new Set(["INTERESSADO", "PEDIU_CATALOGO", "PEDIU_PRECO", "NEGOCIANDO", "PEDIDO_REALIZADO", "RECOMPRA"]);
const NEGATIVOS = new Set(["RECUSOU", "SEM_ADERENCIA", "DADOS_INVALIDOS"]);

function normalizar(v: string | null): string {
  return (v ?? "").trim().toLocaleUpperCase("pt-BR");
}

/**
 * Recebe no máximo a interação mais recente de cada prospecto.
 * Repetir contatos nunca aumenta artificialmente o tamanho da amostra.
 */
export function aprenderPerfis(registros: RegistroAprendizado[], minimoLojas = 5): PerfilAprendido[] {
  const unicos = new Map<string, RegistroAprendizado>();
  for (const registro of registros) {
    if (!unicos.has(registro.prospectId)) unicos.set(registro.prospectId, registro);
  }

  const grupos = new Map<string, { attrs: PerfilAprendido["atributos"]; lojas: RegistroAprendizado[] }>();
  for (const registro of unicos.values()) {
    const attrs = {
      segmentoComercial: registro.segmentoComercial?.trim() || null,
      perfilLoja: registro.perfilLoja?.trim() || null,
      faixaPreco: registro.faixaPreco?.trim() || null,
      estado: registro.estado?.trim()?.toUpperCase() || null,
    };
    if (!attrs.segmentoComercial && !attrs.perfilLoja && !attrs.faixaPreco && !attrs.estado) continue;
    const chave = [attrs.segmentoComercial, attrs.perfilLoja, attrs.faixaPreco, attrs.estado].map(normalizar).join("|");
    const grupo = grupos.get(chave) ?? { attrs, lojas: [] };
    grupo.lojas.push(registro);
    grupos.set(chave, grupo);
  }

  return [...grupos.entries()].flatMap(([chave, grupo]) => {
    const totalLojas = grupo.lojas.length;
    const convertidasDapic = grupo.lojas.filter((x) => x.status === "CONVERTIDO").length;
    const sinaisPositivos = grupo.lojas.filter((x) => x.resultado && POSITIVOS.has(x.resultado)).length;
    const sinaisNegativos = grupo.lojas.filter((x) => x.resultado && NEGATIVOS.has(x.resultado)).length;
    const interacoesComSinal = sinaisPositivos + sinaisNegativos;
    if (totalLojas < minimoLojas || interacoesComSinal < 3) return [];
    const emNegociacao = grupo.lojas.filter((x) => x.status === "NEGOCIACAO").length;
    const a = grupo.attrs;
    const perfil = [
      a.segmentoComercial ?? "segmento não informado",
      a.perfilLoja ?? "perfil não informado",
      a.faixaPreco ?? "faixa de preço não informada",
      a.estado ?? "UF não informada",
    ].join(" · ");
    return [{
      chave, perfil, totalLojas, interacoesComSinal, sinaisPositivos, sinaisNegativos, emNegociacao, convertidasDapic,
      taxaSinalPositivo: Math.round(sinaisPositivos / interacoesComSinal * 100),
      taxaConversaoDapic: Math.round(convertidasDapic / totalLojas * 100),
      confianca: totalLojas >= 20 ? "ALTA" as const : totalLojas >= 10 ? "MEDIA" as const : "BAIXA" as const,
      atributos: a,
    }];
  }).sort((a, b) =>
    b.taxaConversaoDapic - a.taxaConversaoDapic ||
    b.taxaSinalPositivo - a.taxaSinalPositivo ||
    b.totalLojas - a.totalLojas
  ).slice(0, 5);
}

export function pontuarAderenciaPerfil(
  candidato: { segmentoComercial: string | null; perfilLoja: string | null; faixaPreco: string | null; estado: string | null },
  perfis: PerfilAprendido[],
): { pontos: number; correspondencias: string[] } {
  let pontos = 0;
  const correspondencias: string[] = [];
  const pesos = [
    ["segmentoComercial", 3, "segmento"],
    ["perfilLoja", 3, "perfil de loja"],
    ["faixaPreco", 2, "faixa de preço"],
    ["estado", 1, "UF"],
  ] as const;
  for (const perfil of perfis) {
    let pontosPerfil = 0;
    const matches: string[] = [];
    for (const [campo, peso, label] of pesos) {
      const valor = candidato[campo];
      const alvo = perfil.atributos[campo];
      if (valor && alvo && normalizar(valor) === normalizar(alvo)) {
        pontosPerfil += peso;
        matches.push(label);
      }
    }
    if (pontosPerfil > pontos) {
      pontos = pontosPerfil;
      correspondencias.splice(0, correspondencias.length, ...matches);
    }
  }
  return { pontos, correspondencias };
}
