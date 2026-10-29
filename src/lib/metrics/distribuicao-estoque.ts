// ---------------------------------------------------------------------------
// MOTOR DE DISTRIBUIÇÃO DE ESTOQUE ENTRE LOJAS (funções PURAS — sem Prisma)
// ---------------------------------------------------------------------------
// Pedido de 2026-10-29 ("Radar TVB: inteligência de distribuição de estoque"): percorrer 100% do
// catálogo, variante por variante (cod = IdGradeProduto do DAPIC = produto+cor+tamanho), comparar
// estoque × demanda da MESMA variante entre todas as lojas e sugerir transferências internas.
//
// Regras de projeto:
// - Determinístico: os números saem só daqui, nunca de IA. Mesma entrada => mesma saída.
// - Nada é escrito em lugar nenhum: este arquivo não importa Prisma nem o conector DAPIC.
//   Transferência é SUGESTÃO sujeita a aprovação humana (ver `somenteSugestao` no resultado).
// - Nenhuma variante é descartada em silêncio: toda variante do universo recebe um diagnóstico
//   (inclusive "Dados insuficientes"/"Não aplicável", com o motivo), e a execução só é marcada
//   COMPLETA quando processadas + falhas == esperadas e falhas == 0.
// - O ranking da tela é só ordenação de exibição — o universo analisado é sempre o catálogo todo.
//
// A camada que busca os dados reais no banco fica em distribuicao-estoque-dados.ts.

export type PapelLocal = "PONTO_VENDA" | "DEPOSITO" | "EXCLUIDO";

export type LocalEstoque = {
  storeId: string;
  nome: string;
  papel: PapelLocal;
  motivoPapel: string;
  // Store.displayGroup (ex: CD e ATACADO = "TVB Site e Atacado"): armazenadores separados no DAPIC
  // mas do mesmo local físico/operação. Só usado pra avisar na transferência.
  grupoLocal?: string | null;
};

// Fatos de UMA variante em UM local. estoqueFisico null = o DAPIC não mandou linha de estoque
// dessa variante nesse armazenador (diferente de "linha com 0"). estoqueReservado null = reserva
// não disponível na base (hoje o sync não grava QuantidadeComprometida — ver limitações).
export type FatosLojaVariante = {
  storeId: string;
  estoqueFisico: number | null;
  estoqueReservado: number | null;
  vendas30: number;
  vendas60: number;
  vendas90: number;
  devolucoes30: number;
  devolucoes60: number;
  devolucoes90: number;
  brindes90: number;
  canceladas90: number;
  ultimaVenda: Date | null;
};

export type VarianteCatalogo = {
  cod: string;
  produto: string | null;
  grupo: string | null;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  // Primeira evidência de existência comercial (1ª venda, 1ª produção finalizada ou data de
  // lançamento cadastrada — a mais antiga). null = idade desconhecida.
  primeiraAparicao: Date | null;
  // De onde a variante entrou no universo (estoque, venda, catálogo de preços...). Só auditoria.
  fontes: string[];
  lojas: FatosLojaVariante[];
  custoUnitario: number | null;
};

// Limites configuráveis. Os valores padrão NÃO são um percentual universal inventado — cada um
// está amarrado a uma convenção que a TVB já usa no próprio Radar, e devem ser recalibrados com a
// operação depois de algumas rodadas reais:
// - coberturaAlvoDias = 60: mesma cobertura padrão do Mapa de Compras (COBERTURA_PADRAO_MESES = 2
//   em estoque.ts, e o default de CoberturaMeta.mesesCobertura).
// - coberturaProtegidaOrigemDias = 60: a origem nunca fica abaixo da MESMA cobertura que o destino
//   está tentando alcançar (não desprotege uma loja pra proteger outra).
// - limiarSubalocacaoDias = 14: entre a regra de "ruptura iminente" do Mapa de Compras (< 7 dias)
//   e a reposição semanal da tela de Reposição — abaixo de 2 semanas a loja não chega no próximo
//   ciclo de reposição.
// - limiarExcessoDias = 120: 2× a cobertura-alvo.
// - limiarSaldoParticipacao = 0.20: a loja só é "desbalanceada" se a fatia dela no estoque da
//   variante se afasta 20 pontos percentuais da fatia dela na demanda — com 4 a 6 pontos de venda,
//   uma loja "média" tem 15–25% de cada lado; 20pp é o tamanho de uma loja inteira de diferença.
// - janelaDemandaDias = 90 e minVendasLiquidasConclusivo = 3: menos de 3 peças líquidas em 90
//   dias (≈1 por mês) é amostra pequena demais pra separar demanda de acaso.
// - minVendasDestino = 2: destino só recebe se vendeu ao menos 2 peças líquidas na janela.
// - reservaMinimaOrigemUnidades = 1: mesma regra da Reposição de lojas ("nunca zera o CD").
// - idadeMinimaParadoDias = 90: produto com menos de 90 dias de vida não é "parado", é recente.
export type ConfigDistribuicao = {
  janelaDemandaDias: number;
  coberturaAlvoDias: number;
  coberturaProtegidaOrigemDias: number;
  limiarSubalocacaoDias: number;
  limiarExcessoDias: number;
  limiarSaldoParticipacao: number;
  minVendasLiquidasConclusivo: number;
  minVendasDestino: number;
  minVendasConfiancaAlta: number;
  idadeMinimaParadoDias: number;
  reservaMinimaOrigemUnidades: number;
  minUnidadesTransferencia: number;
  tamanhoLote: number;
};

export const CONFIG_DISTRIBUICAO_PADRAO: ConfigDistribuicao = {
  janelaDemandaDias: 90,
  coberturaAlvoDias: 60,
  coberturaProtegidaOrigemDias: 60,
  limiarSubalocacaoDias: 14,
  limiarExcessoDias: 120,
  limiarSaldoParticipacao: 0.2,
  minVendasLiquidasConclusivo: 3,
  minVendasDestino: 2,
  minVendasConfiancaAlta: 10,
  idadeMinimaParadoDias: 90,
  reservaMinimaOrigemUnidades: 1,
  minUnidadesTransferencia: 1,
  tamanhoLote: 500,
};

export type DiagnosticoVariante =
  | "EQUILIBRADA"
  | "POSSIVEL_EXCESSO"
  | "POSSIVEL_SUBALOCACAO"
  | "ESTOQUE_PARADO"
  | "ESTOQUE_TOTAL_INSUFICIENTE"
  | "TRANSFERENCIA_POSSIVEL"
  | "DADOS_INSUFICIENTES"
  | "SEM_ESTOQUE_SEM_DEMANDA"
  | "NAO_APLICAVEL";

export type DiagnosticoLoja =
  | "EQUILIBRADA"
  | "POSSIVEL_EXCESSO"
  | "POSSIVEL_SUBALOCACAO"
  | "ESTOQUE_PARADO"
  | "SEM_DEMANDA_RECENTE"
  | "SEM_ESTOQUE_SEM_DEMANDA"
  | "DEPOSITO"
  | "DADOS_INSUFICIENTES";

export type Confianca = "ALTA" | "MEDIA" | "BAIXA";

export const DIAGNOSTICO_LABEL: Record<DiagnosticoVariante, string> = {
  EQUILIBRADA: "Distribuição equilibrada",
  POSSIVEL_EXCESSO: "Possível excesso relativo",
  POSSIVEL_SUBALOCACAO: "Possível subalocação",
  ESTOQUE_PARADO: "Estoque parado",
  ESTOQUE_TOTAL_INSUFICIENTE: "Estoque total insuficiente",
  TRANSFERENCIA_POSSIVEL: "Possível transferência entre lojas",
  DADOS_INSUFICIENTES: "Dados insuficientes",
  SEM_ESTOQUE_SEM_DEMANDA: "Sem estoque e sem demanda",
  NAO_APLICAVEL: "Não aplicável (insumo/sem grupo)",
};

// Diagnósticos "conclusivos" = o motor conseguiu afirmar algo sobre a distribuição. Dados
// insuficientes e Não aplicável NÃO são conclusivos (contados à parte nas contagens).
export const DIAGNOSTICOS_CONCLUSIVOS: DiagnosticoVariante[] = [
  "EQUILIBRADA",
  "POSSIVEL_EXCESSO",
  "POSSIVEL_SUBALOCACAO",
  "ESTOQUE_PARADO",
  "ESTOQUE_TOTAL_INSUFICIENTE",
  "TRANSFERENCIA_POSSIVEL",
  "SEM_ESTOQUE_SEM_DEMANDA",
];

export type IndicadoresLoja = {
  storeId: string;
  nome: string;
  papel: PapelLocal;
  semLinhaEstoque: boolean;
  estoqueFisico: number;
  estoqueReservado: number | null;
  estoqueDisponivel: number;
  vendasLiquidas30: number;
  vendasLiquidas60: number;
  vendasLiquidas90: number;
  devolucoes90: number;
  brindes90: number;
  canceladas90: number;
  velocidadeDiaria: number;
  coberturaDias: number | null;
  participacaoEstoque: number | null;
  participacaoDemanda: number | null;
  saldoParticipacao: number | null;
  rupturaAtual: boolean;
  diasDesdeUltimaVenda: number | null;
  diagnostico: DiagnosticoLoja;
  justificativa: string[];
};

export type LadoTransferencia = {
  storeId: string;
  nome: string;
  estoqueDisponivelAntes: number;
  estoqueDisponivelDepois: number;
  vendasLiquidas90: number;
  velocidadeDiaria: number;
  coberturaAntesDias: number | null;
  coberturaDepoisDias: number | null;
};

export type SugestaoTransferencia = {
  id: string;
  cod: string;
  produto: string | null;
  grupo: string | null;
  cor: string | null;
  tamanho: string | null;
  origem: LadoTransferencia;
  destino: LadoTransferencia;
  quantidade: number;
  justificativa: string;
  confianca: Confianca;
  limitacoes: string[];
  // Sempre true: é sugestão pra aprovação humana, nunca uma ordem executada.
  somenteSugestao: true;
};

export type ResultadoVariante = {
  cod: string;
  produto: string | null;
  grupo: string | null;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  idadeDias: number | null;
  diagnostico: DiagnosticoVariante;
  confianca: Confianca;
  conclusivo: boolean;
  estoqueFisicoTotal: number;
  estoqueDisponivelTotal: number;
  estoqueForaDeVenda: number;
  vendasLiquidas30: number;
  vendasLiquidas60: number;
  vendasLiquidas90: number;
  velocidadeDiariaTotal: number;
  coberturaGlobalDias: number | null;
  // Maior |saldo de participação| entre os pontos de venda — base do ranking de desequilíbrio.
  maiorDesequilibrio: number;
  unidadesTransferiveis: number;
  lojas: IndicadoresLoja[];
  transferencias: SugestaoTransferencia[];
  justificativa: string[];
  limitacoes: string[];
  inconsistencias: string[];
  fontes: string[];
};

const DIA_MS = 86_400_000;

function arred(n: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function cobertura(disponivel: number, velocidade: number): number | null {
  return velocidade > 0 ? disponivel / velocidade : null;
}

function nomeVariante(v: Pick<VarianteCatalogo, "produto" | "cor" | "tamanho" | "cod">): string {
  const partes = [v.produto ?? `SKU ${v.cod}`];
  if (v.cor) partes.push(v.cor);
  if (v.tamanho) partes.push(`tam. ${v.tamanho}`);
  return partes.join(" · ");
}

// Venda líquida = vendas válidas (status != "Cancelada", brinde fora) − devoluções válidas, na
// mesma loja e janela. Pode dar negativo quando a devolução é de uma venda anterior à janela —
// nesse caso a demanda considerada é 0 (nunca negativa) e o fato vira inconsistência registrada.
export function vendaLiquida(vendas: number, devolucoes: number): number {
  return vendas - devolucoes;
}

// Análise de UMA variante. Exportada pra teste cenário a cenário; o lote só chama isto em loop.
export function analisarVariante(
  variante: VarianteCatalogo,
  locais: LocalEstoque[],
  referencia: Date,
  config: ConfigDistribuicao = CONFIG_DISTRIBUICAO_PADRAO
): ResultadoVariante {
  const justificativa: string[] = [];
  const limitacoes: string[] = [];
  const inconsistencias: string[] = [];

  const idadeDias = variante.primeiraAparicao
    ? Math.max(Math.floor((referencia.getTime() - variante.primeiraAparicao.getTime()) / DIA_MS), 0)
    : null;
  // Dias efetivamente observáveis na janela: produto lançado há 20 dias não teve 90 dias pra
  // vender — dividir por 90 subestimaria a velocidade em 4,5×. Idade desconhecida => janela cheia
  // (escolha conservadora: velocidade menor, nunca inflada), registrada como limitação.
  const diasObservacao =
    idadeDias == null ? config.janelaDemandaDias : Math.min(Math.max(idadeDias, 1), config.janelaDemandaDias);
  if (idadeDias == null) {
    limitacoes.push(
      `Idade da variante desconhecida (sem 1ª venda, produção ou lançamento registrado) — velocidade calculada sobre a janela cheia de ${config.janelaDemandaDias} dias.`
    );
  } else if (idadeDias < config.janelaDemandaDias) {
    justificativa.push(`Variante com ${idadeDias} dia(s) de vida — velocidade calculada sobre ${diasObservacao} dia(s), não sobre ${config.janelaDemandaDias}.`);
  }
  if (!variante.cor) limitacoes.push("Cor não informada pelo DAPIC para esta variante.");
  if (!variante.tamanho) limitacoes.push("Tamanho não informado pelo DAPIC para esta variante.");
  if (!variante.produto) inconsistencias.push("Variante sem nome de produto em nenhuma fonte sincronizada (só existe no catálogo de preços).");
  if (!variante.grupo) inconsistencias.push("Variante sem grupo em nenhuma fonte sincronizada.");

  const fatosPorLoja = new Map(variante.lojas.map((f) => [f.storeId, f]));
  for (const f of variante.lojas) {
    if (!locais.some((l) => l.storeId === f.storeId)) {
      inconsistencias.push(`Registro em armazenador desconhecido (${f.storeId}) — não incluído na análise.`);
    }
  }

  const analisados = locais.filter((l) => l.papel !== "EXCLUIDO");
  let estoqueForaDeVenda = 0;
  for (const l of locais) {
    if (l.papel !== "EXCLUIDO") continue;
    const f = fatosPorLoja.get(l.storeId);
    if (f?.estoqueFisico && f.estoqueFisico > 0) estoqueForaDeVenda += f.estoqueFisico;
  }
  if (estoqueForaDeVenda > 0) {
    justificativa.push(`${estoqueForaDeVenda} un em armazenadores fora de venda (defeito/lixeira/bonificação etc.) — não contadas como disponíveis.`);
  }

  let reservaDesconhecida = false;
  const lojas: IndicadoresLoja[] = analisados.map((l) => {
    const f = fatosPorLoja.get(l.storeId);
    const semLinhaEstoque = f?.estoqueFisico == null;
    const fisicoBruto = f?.estoqueFisico ?? 0;
    if (fisicoBruto < 0) {
      inconsistencias.push(`Estoque físico negativo (${fisicoBruto}) registrado em ${l.nome} — tratado como 0.`);
    }
    const estoqueFisico = Math.max(fisicoBruto, 0);
    const estoqueReservado = f?.estoqueReservado ?? null;
    if (estoqueReservado == null && estoqueFisico > 0) reservaDesconhecida = true;
    const estoqueDisponivel = Math.max(estoqueFisico - (estoqueReservado ?? 0), 0);

    const liq30 = vendaLiquida(f?.vendas30 ?? 0, f?.devolucoes30 ?? 0);
    const liq60 = vendaLiquida(f?.vendas60 ?? 0, f?.devolucoes60 ?? 0);
    const liq90 = vendaLiquida(f?.vendas90 ?? 0, f?.devolucoes90 ?? 0);
    if (liq90 < 0) {
      inconsistencias.push(`Devoluções superam vendas em ${l.nome} nos últimos ${config.janelaDemandaDias} dias (${liq90}) — demanda considerada 0.`);
    }
    const demanda90 = Math.max(liq90, 0);
    const velocidadeDiaria = l.papel === "PONTO_VENDA" ? demanda90 / diasObservacao : 0;
    const diasDesdeUltimaVenda = f?.ultimaVenda
      ? Math.floor((referencia.getTime() - f.ultimaVenda.getTime()) / DIA_MS)
      : null;

    return {
      storeId: l.storeId,
      nome: l.nome,
      papel: l.papel,
      semLinhaEstoque,
      estoqueFisico,
      estoqueReservado,
      estoqueDisponivel,
      vendasLiquidas30: liq30,
      vendasLiquidas60: liq60,
      vendasLiquidas90: liq90,
      devolucoes90: f?.devolucoes90 ?? 0,
      brindes90: f?.brindes90 ?? 0,
      canceladas90: f?.canceladas90 ?? 0,
      velocidadeDiaria,
      coberturaDias: cobertura(estoqueDisponivel, velocidadeDiaria),
      participacaoEstoque: null,
      participacaoDemanda: null,
      saldoParticipacao: null,
      rupturaAtual: l.papel === "PONTO_VENDA" && estoqueDisponivel === 0 && (f?.ultimaVenda != null),
      diasDesdeUltimaVenda,
      diagnostico: "EQUILIBRADA" as DiagnosticoLoja,
      justificativa: [] as string[],
    };
  });
  if (reservaDesconhecida) {
    limitacoes.push("Estoque reservado/comprometido não disponível na base sincronizada — disponível = físico registrado.");
  }

  const pontos = lojas.filter((l) => l.papel === "PONTO_VENDA");
  const estoqueFisicoTotal = lojas.reduce((s, l) => s + l.estoqueFisico, 0);
  const estoqueDisponivelTotal = lojas.reduce((s, l) => s + l.estoqueDisponivel, 0);
  const liqTotal30 = pontos.reduce((s, l) => s + l.vendasLiquidas30, 0);
  const liqTotal60 = pontos.reduce((s, l) => s + l.vendasLiquidas60, 0);
  const liqTotal90 = pontos.reduce((s, l) => s + l.vendasLiquidas90, 0);
  const demandaTotal90 = pontos.reduce((s, l) => s + Math.max(l.vendasLiquidas90, 0), 0);
  const velocidadeDiariaTotal = pontos.reduce((s, l) => s + l.velocidadeDiaria, 0);
  const coberturaGlobalDias = cobertura(estoqueDisponivelTotal, velocidadeDiariaTotal);

  // Participações: estoque dividido pelo total disponível dos locais analisados (pontos +
  // depósitos), demanda pelo total dos pontos de venda. Saldo = estoque − demanda (+ = loja tem
  // mais estoque do que sua fatia de demanda justificaria).
  for (const l of lojas) {
    l.participacaoEstoque = estoqueDisponivelTotal > 0 ? l.estoqueDisponivel / estoqueDisponivelTotal : null;
    if (l.papel === "PONTO_VENDA") {
      l.participacaoDemanda = demandaTotal90 > 0 ? Math.max(l.vendasLiquidas90, 0) / demandaTotal90 : null;
      l.saldoParticipacao =
        l.participacaoEstoque != null && l.participacaoDemanda != null ? l.participacaoEstoque - l.participacaoDemanda : null;
    }
  }

  const idadeConhecidaMadura = idadeDias != null && idadeDias >= config.idadeMinimaParadoDias;

  // Diagnóstico por loja.
  for (const l of lojas) {
    if (l.papel === "DEPOSITO") {
      l.diagnostico = "DEPOSITO";
      l.justificativa.push("Local com estoque mas sem venda registrada na janela para nenhum produto — tratado como depósito (pode enviar, não recebe).");
      continue;
    }
    const demanda = Math.max(l.vendasLiquidas90, 0);
    if (l.estoqueDisponivel === 0 && demanda === 0) {
      l.diagnostico = "SEM_ESTOQUE_SEM_DEMANDA";
      l.justificativa.push(
        l.diasDesdeUltimaVenda != null
          ? `Sem estoque e sem venda líquida na janela; última venda há ${l.diasDesdeUltimaVenda} dia(s) — ausência de venda pode ser efeito de ruptura, não falta de demanda.`
          : "Sem estoque e sem venda registrada nesta loja."
      );
      continue;
    }
    if (l.estoqueDisponivel > 0 && demanda === 0) {
      if (idadeConhecidaMadura) {
        l.diagnostico = "ESTOQUE_PARADO";
        l.justificativa.push(`${l.estoqueDisponivel} un sem nenhuma venda líquida em ${config.janelaDemandaDias} dias (variante com ${idadeDias} dias de vida).`);
      } else {
        l.diagnostico = "SEM_DEMANDA_RECENTE";
        l.justificativa.push(
          idadeDias == null
            ? "Sem venda na janela, mas idade da variante desconhecida — não afirmado como parado."
            : `Sem venda na janela, mas variante tem só ${idadeDias} dia(s) — recente demais para afirmar estoque parado.`
        );
      }
      continue;
    }
    if (demanda < config.minVendasDestino) {
      l.diagnostico = "DADOS_INSUFICIENTES";
      l.justificativa.push(`Só ${demanda} venda(s) líquida(s) em ${config.janelaDemandaDias} dias nesta loja — amostra pequena para afirmar desequilíbrio.`);
      continue;
    }
    const cob = l.coberturaDias ?? 0;
    const saldo = l.saldoParticipacao ?? 0;
    // Subalocação: cobertura curta E (fatia de estoque bem abaixo da fatia de demanda OU a empresa
    // tem estoque suficiente no total). O 2º caso pega a loja pequena zerada — achado validando com
    // dado real (2026-10-29): ATACADO com 0 un e 56 vendas em 90 dias tinha só 13,9% da demanda,
    // abaixo dos 20pp, e saía como "equilibrada" com 0 dia de cobertura. Quando a empresa toda está
    // curta, nenhum dos dois vale e a variante cai em "estoque total insuficiente".
    const globalFolgada = coberturaGlobalDias != null && coberturaGlobalDias >= config.limiarSubalocacaoDias;
    if (cob < config.limiarSubalocacaoDias && (-saldo >= config.limiarSaldoParticipacao || globalFolgada)) {
      l.diagnostico = "POSSIVEL_SUBALOCACAO";
      l.justificativa.push(
        -saldo >= config.limiarSaldoParticipacao
          ? `Cobertura de ${arred(cob, 1)} dia(s) (< ${config.limiarSubalocacaoDias}) e fatia do estoque (${pct(l.participacaoEstoque)}) bem abaixo da fatia da demanda (${pct(l.participacaoDemanda)}).`
          : `Cobertura de ${arred(cob, 1)} dia(s) (< ${config.limiarSubalocacaoDias}) enquanto a empresa toda tem ${arred(coberturaGlobalDias!, 1)} dia(s) de cobertura.`
      );
    } else if (cob > config.limiarExcessoDias && saldo >= config.limiarSaldoParticipacao) {
      l.diagnostico = "POSSIVEL_EXCESSO";
      l.justificativa.push(
        `Cobertura de ${arred(cob, 1)} dia(s) (> ${config.limiarExcessoDias}) e fatia do estoque (${pct(l.participacaoEstoque)}) bem acima da fatia da demanda (${pct(l.participacaoDemanda)}).`
      );
    } else {
      l.diagnostico = "EQUILIBRADA";
      l.justificativa.push(`Cobertura de ${arred(cob, 1)} dia(s); estoque ${pct(l.participacaoEstoque)} × demanda ${pct(l.participacaoDemanda)}.`);
    }
    if (l.rupturaAtual) {
      l.justificativa.push("Loja zerada: a venda observada pode estar subestimada pela ruptura (não extrapolada).");
    }
  }

  const maiorDesequilibrio = pontos.reduce((m, l) => Math.max(m, Math.abs(l.saldoParticipacao ?? 0)), 0);

  const base = {
    cod: variante.cod,
    produto: variante.produto,
    grupo: variante.grupo,
    cor: variante.cor,
    tamanho: variante.tamanho,
    colecao: variante.colecao,
    idadeDias,
    estoqueFisicoTotal,
    estoqueDisponivelTotal,
    estoqueForaDeVenda,
    vendasLiquidas30: liqTotal30,
    vendasLiquidas60: liqTotal60,
    vendasLiquidas90: liqTotal90,
    velocidadeDiariaTotal,
    coberturaGlobalDias,
    maiorDesequilibrio,
    lojas,
    limitacoes,
    inconsistencias,
    fontes: variante.fontes,
  };

  function fechar(
    diagnostico: DiagnosticoVariante,
    confianca: Confianca,
    transferencias: SugestaoTransferencia[] = []
  ): ResultadoVariante {
    return {
      ...base,
      diagnostico,
      confianca,
      conclusivo: DIAGNOSTICOS_CONCLUSIVOS.includes(diagnostico),
      unidadesTransferiveis: transferencias.reduce((s, t) => s + t.quantidade, 0),
      transferencias,
      justificativa,
    };
  }

  // 1) Fora do escopo: "(sem grupo)" é matéria-prima/insumo (mesma regra de stockWhere em core.ts).
  if (variante.grupo === "(sem grupo)") {
    justificativa.push("Variante sem grupo de produto — na base da TVB isso é matéria-prima/insumo, não peça de venda. Contada no universo, fora da análise de distribuição.");
    return fechar("NAO_APLICAVEL", "ALTA");
  }

  // 2) Nada para distribuir.
  if (estoqueDisponivelTotal === 0 && demandaTotal90 === 0) {
    justificativa.push(`Sem estoque disponível em nenhum local e sem venda líquida nos últimos ${config.janelaDemandaDias} dias.`);
    return fechar("SEM_ESTOQUE_SEM_DEMANDA", variante.produto ? "ALTA" : "MEDIA");
  }

  // 3) Estoque sem nenhuma venda.
  if (demandaTotal90 === 0) {
    if (idadeConhecidaMadura) {
      justificativa.push(
        `${estoqueDisponivelTotal} un disponíveis e nenhuma venda líquida em ${config.janelaDemandaDias} dias em nenhuma loja, com ${idadeDias} dias de vida.`
      );
      return fechar("ESTOQUE_PARADO", idadeDias! >= 2 * config.idadeMinimaParadoDias ? "ALTA" : "MEDIA");
    }
    justificativa.push(
      idadeDias == null
        ? "Estoque sem venda na janela, mas sem como saber a idade da variante — não é possível afirmar que está parado."
        : `Estoque sem venda na janela, mas variante tem só ${idadeDias} dia(s) — lançamento recente, sem histórico para diagnóstico.`
    );
    return fechar("DADOS_INSUFICIENTES", "BAIXA");
  }

  // 4) Amostra de venda pequena demais.
  if (demandaTotal90 < config.minVendasLiquidasConclusivo) {
    justificativa.push(
      `Só ${demandaTotal90} venda(s) líquida(s) em ${config.janelaDemandaDias} dias somando todas as lojas (mínimo para diagnóstico: ${config.minVendasLiquidasConclusivo}).`
    );
    return fechar("DADOS_INSUFICIENTES", "BAIXA");
  }

  // Confiança geral da variante.
  const algumaRuptura = pontos.some((l) => l.rupturaAtual);
  let confianca: Confianca =
    demandaTotal90 >= config.minVendasConfiancaAlta && idadeDias != null && idadeDias >= config.janelaDemandaDias
      ? "ALTA"
      : "MEDIA";
  if (algumaRuptura && confianca === "ALTA") {
    confianca = "MEDIA";
    limitacoes.push("Há loja zerada com histórico de venda: sem histórico diário de disponibilidade, a demanda dessa loja pode estar subestimada pela ruptura.");
  }
  if (inconsistencias.length > 0 && confianca === "ALTA") confianca = "MEDIA";

  // 5) Transferências (só do excedente real acima da proteção da origem).
  const transferencias = calcularTransferencias(
    variante,
    lojas,
    config,
    confianca,
    new Map(locais.map((l) => [l.storeId, l.grupoLocal]))
  );
  const globalInsuficiente =
    coberturaGlobalDias != null && coberturaGlobalDias < config.limiarSubalocacaoDias;

  if (globalInsuficiente) {
    justificativa.push(
      `Cobertura da empresa toda é de ${arred(coberturaGlobalDias!, 1)} dia(s) (< ${config.limiarSubalocacaoDias}): falta estoque no total, não só na distribuição.`
    );
    if (transferencias.length > 0) {
      justificativa.push("Transferências sugeridas só aliviam pontualmente — não resolvem a insuficiência global (avaliar reposição/compra no Mapa de Compras).");
    }
    return fechar("ESTOQUE_TOTAL_INSUFICIENTE", confianca, transferencias);
  }
  if (transferencias.length > 0) {
    justificativa.push(
      `${transferencias.reduce((s, t) => s + t.quantidade, 0)} un podem ser remanejadas de loja com excedente para loja com cobertura abaixo de ${config.limiarSubalocacaoDias} dias, sem deixar a origem abaixo de ${config.coberturaProtegidaOrigemDias} dias.`
    );
    return fechar("TRANSFERENCIA_POSSIVEL", confianca, transferencias);
  }
  const sub = pontos.filter((l) => l.diagnostico === "POSSIVEL_SUBALOCACAO");
  const exc = lojas.filter((l) => l.diagnostico === "POSSIVEL_EXCESSO" || l.diagnostico === "ESTOQUE_PARADO");
  if (sub.length > 0) {
    justificativa.push(
      `Subalocação em ${sub.map((l) => l.nome).join(", ")}, mas nenhuma outra loja tem excedente acima da cobertura protegida para transferir.`
    );
    return fechar("POSSIVEL_SUBALOCACAO", confianca);
  }
  if (exc.length > 0) {
    justificativa.push(`Estoque acima da demanda em ${exc.map((l) => l.nome).join(", ")}, sem loja com falta para receber agora.`);
    return fechar("POSSIVEL_EXCESSO", confianca);
  }
  justificativa.push("Fatia de estoque de cada loja compatível com a fatia de demanda; nenhuma loja abaixo do limiar de cobertura.");
  return fechar("EQUILIBRADA", confianca);
}

function pct(v: number | null): string {
  return v == null ? "—" : `${arred(v * 100, 1)}%`;
}

// Casa destinos (cobertura abaixo do limiar, demanda mínima comprovada) com origens que têm
// excedente acima da proteção — guloso e determinístico: destino mais urgente primeiro, origem com
// mais excedente primeiro, desempate por storeId. Garantias (cobertas por teste):
// - quantidade ≤ excedente da origem ≤ disponível da origem;
// - origem fica com ≥ max(ceil(velocidade × coberturaProtegida), reservaMínima) unidades;
// - destino recebe no máximo o que falta pra atingir a cobertura-alvo.
export function calcularTransferencias(
  variante: Pick<VarianteCatalogo, "cod" | "produto" | "grupo" | "cor" | "tamanho">,
  lojas: IndicadoresLoja[],
  config: ConfigDistribuicao,
  confianca: Confianca,
  grupoLocalPorId: Map<string, string | null | undefined> = new Map()
): SugestaoTransferencia[] {
  const destinos = lojas
    .filter(
      (l) =>
        l.papel === "PONTO_VENDA" &&
        l.velocidadeDiaria > 0 &&
        Math.max(l.vendasLiquidas90, 0) >= config.minVendasDestino &&
        (l.coberturaDias ?? 0) < config.limiarSubalocacaoDias
    )
    .map((l) => ({ loja: l, falta: Math.ceil(l.velocidadeDiaria * config.coberturaAlvoDias) - l.estoqueDisponivel }))
    .filter((d) => d.falta > 0)
    .sort(
      (a, b) =>
        (a.loja.coberturaDias ?? 0) - (b.loja.coberturaDias ?? 0) || b.falta - a.falta || a.loja.storeId.localeCompare(b.loja.storeId)
    );
  if (destinos.length === 0) return [];

  const idsDestino = new Set(destinos.map((d) => d.loja.storeId));
  const origens = lojas
    .filter((l) => l.papel !== "EXCLUIDO" && !idsDestino.has(l.storeId))
    .map((l) => {
      const protecao = Math.max(Math.ceil(l.velocidadeDiaria * config.coberturaProtegidaOrigemDias), config.reservaMinimaOrigemUnidades);
      return { loja: l, protecao, excedente: Math.max(l.estoqueDisponivel - protecao, 0) };
    })
    .filter((o) => o.excedente > 0)
    .sort((a, b) => b.excedente - a.excedente || a.loja.storeId.localeCompare(b.loja.storeId));
  if (origens.length === 0) return [];

  const saldoOrigem = new Map(origens.map((o) => [o.loja.storeId, o.loja.estoqueDisponivel]));
  const saldoDestino = new Map(destinos.map((d) => [d.loja.storeId, d.loja.estoqueDisponivel]));
  const resultado: SugestaoTransferencia[] = [];

  for (const d of destinos) {
    let falta = d.falta;
    for (const o of origens) {
      if (falta <= 0) break;
      if (o.excedente <= 0) continue;
      const qtd = Math.min(falta, o.excedente);
      if (qtd < config.minUnidadesTransferencia) continue;
      const origemAntes = saldoOrigem.get(o.loja.storeId)!;
      const destinoAntes = saldoDestino.get(d.loja.storeId)!;
      const origemDepois = origemAntes - qtd;
      const destinoDepois = destinoAntes + qtd;
      o.excedente -= qtd;
      falta -= qtd;
      saldoOrigem.set(o.loja.storeId, origemDepois);
      saldoDestino.set(d.loja.storeId, destinoDepois);

      const limitacoes: string[] = [];
      if (d.loja.rupturaAtual) limitacoes.push("Destino zerado: demanda observada pode estar subestimada pela ruptura (quantidade não inflada por isso).");
      const go = grupoLocalPorId.get(o.loja.storeId);
      if (go && go === grupoLocalPorId.get(d.loja.storeId)) {
        limitacoes.push(`Origem e destino são armazenadores do mesmo grupo (${go}) — remanejamento contábil entre armazenadores, não transporte entre lojas.`);
      }
      if (o.loja.papel === "DEPOSITO") limitacoes.push("Origem é um depósito sem venda própria — confirmar se o estoque está liberado para lojas.");
      limitacoes.push("Sugestão sujeita à aprovação humana — nenhuma transferência é executada pelo Radar.");

      const coberturaOrigemDepois = cobertura(origemDepois, o.loja.velocidadeDiaria);
      resultado.push({
        id: `${variante.cod}:${o.loja.storeId}->${d.loja.storeId}`,
        cod: variante.cod,
        produto: variante.produto,
        grupo: variante.grupo,
        cor: variante.cor,
        tamanho: variante.tamanho,
        quantidade: qtd,
        origem: lado(o.loja, origemAntes, origemDepois),
        destino: lado(d.loja, destinoAntes, destinoDepois),
        justificativa:
          `${d.loja.nome} vendeu ${Math.max(d.loja.vendasLiquidas90, 0)} un líquidas em ${config.janelaDemandaDias} dias e tem cobertura de ` +
          `${arred(d.loja.coberturaDias ?? 0, 1)} dia(s); ${o.loja.nome} tem ${origemAntes} un e precisa manter ${o.protecao} ` +
          `(${o.loja.velocidadeDiaria > 0 ? `${config.coberturaProtegidaOrigemDias} dias de cobertura` : "reserva mínima, sem venda própria"}) — ` +
          `${qtd} un levam o destino a ${arred(cobertura(destinoDepois, d.loja.velocidadeDiaria) ?? 0, 1)} dia(s)` +
          (coberturaOrigemDepois != null ? ` e deixam a origem com ${arred(coberturaOrigemDepois, 1)} dia(s).` : "."),
        confianca: d.loja.rupturaAtual && confianca === "ALTA" ? "MEDIA" : confianca,
        limitacoes,
        somenteSugestao: true,
      });
    }
  }
  return resultado;
}

function lado(l: IndicadoresLoja, antes: number, depois: number): LadoTransferencia {
  return {
    storeId: l.storeId,
    nome: l.nome,
    estoqueDisponivelAntes: antes,
    estoqueDisponivelDepois: depois,
    vendasLiquidas90: l.vendasLiquidas90,
    velocidadeDiaria: l.velocidadeDiaria,
    coberturaAntesDias: cobertura(antes, l.velocidadeDiaria),
    coberturaDepoisDias: cobertura(depois, l.velocidadeDiaria),
  };
}

// ---------------------------------------------------------------------------
// EXECUÇÃO EM LOTES (com progresso, falhas registradas e retomada)
// ---------------------------------------------------------------------------

export type EntradaDistribuicao = {
  variantes: VarianteCatalogo[];
  locais: LocalEstoque[];
  referencia: Date;
  // Identifica os dados analisados (ex: último sync de estoque + último sync de vendas). Duas
  // execuções com a mesma versão e mesma config produzem o mesmo resultado.
  versaoDados: string;
  limitacoesGlobais?: string[];
};

export type StatusExecucao = "EM_PROCESSAMENTO" | "COMPLETA" | "COMPLETA_COM_FALHAS";

export type EstadoExecucao = {
  id: string;
  versaoDados: string;
  totalEsperado: number;
  cursor: number;
  lotesProcessados: number;
  resultados: ResultadoVariante[];
  falhas: { cod: string; erro: string }[];
  iniciadoEm: string;
  concluidoEm: string | null;
  status: StatusExecucao;
};

function hashCurto(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Ordem estável do universo (por cod) — é o que torna a retomada por cursor segura: o lote N de
// uma retomada é exatamente o mesmo lote N da execução original.
export function ordenarUniverso(variantes: VarianteCatalogo[]): VarianteCatalogo[] {
  return [...variantes].sort((a, b) => (a.cod < b.cod ? -1 : a.cod > b.cod ? 1 : 0));
}

export function iniciarExecucao(entrada: EntradaDistribuicao, agora: Date = new Date()): EstadoExecucao {
  return {
    id: `dist-${hashCurto(`${entrada.versaoDados}|${entrada.variantes.length}|${entrada.locais.length}`)}`,
    versaoDados: entrada.versaoDados,
    totalEsperado: entrada.variantes.length,
    cursor: 0,
    lotesProcessados: 0,
    resultados: [],
    falhas: [],
    iniciadoEm: agora.toISOString(),
    concluidoEm: null,
    status: "EM_PROCESSAMENTO",
  };
}

// Processa até `maxLotes` lotes a partir do cursor do estado recebido. Uma variante que lança
// erro vira falha registrada (com o cod) e o lote continua — nunca derruba a execução nem some.
// Chamar de novo com o estado devolvido continua de onde parou (retomada).
export function processarLotes(
  entrada: EntradaDistribuicao,
  estado: EstadoExecucao,
  config: ConfigDistribuicao = CONFIG_DISTRIBUICAO_PADRAO,
  maxLotes = Infinity
): EstadoExecucao {
  if (estado.versaoDados !== entrada.versaoDados) {
    throw new Error(`Retomada com versão de dados diferente (${estado.versaoDados} ≠ ${entrada.versaoDados}) — reinicie a execução.`);
  }
  const universo = ordenarUniverso(entrada.variantes);
  const novo: EstadoExecucao = { ...estado, resultados: [...estado.resultados], falhas: [...estado.falhas] };
  let lotes = 0;
  while (novo.cursor < universo.length && lotes < maxLotes) {
    const fim = Math.min(novo.cursor + config.tamanhoLote, universo.length);
    for (let i = novo.cursor; i < fim; i++) {
      const v = universo[i];
      try {
        novo.resultados.push(analisarVariante(v, entrada.locais, entrada.referencia, config));
      } catch (e) {
        novo.falhas.push({ cod: v.cod, erro: e instanceof Error ? e.message : String(e) });
      }
    }
    novo.cursor = fim;
    novo.lotesProcessados += 1;
    lotes += 1;
  }
  if (novo.cursor >= universo.length) {
    novo.status = novo.falhas.length > 0 ? "COMPLETA_COM_FALHAS" : "COMPLETA";
    novo.concluidoEm = new Date().toISOString();
  }
  return novo;
}

export type ContagensDistribuicao = {
  produtosUnicos: number;
  variantesUnicas: number;
  locaisAnalisados: number;
  locaisExcluidos: number;
  combinacoesEsperadas: number;
  combinacoesProcessadas: number;
  variantesProcessadas: number;
  variantesComFalha: number;
  variantesPendentes: number;
  conclusivas: number;
  dadosInsuficientes: number;
  naoAplicaveis: number;
  porDiagnostico: Record<DiagnosticoVariante, number>;
  porConfianca: Record<Confianca, number>;
  variantesComInconsistencia: number;
  produtosComDadosAusentesOuInconsistentes: number;
  transferenciasSugeridas: number;
  unidadesTransferiveis: number;
  // true só quando processadas + falhas == esperadas e combinações processadas == esperadas.
  reconciliado: boolean;
};

export type ResultadoDistribuicao = {
  execucao: EstadoExecucao;
  contagens: ContagensDistribuicao;
  locais: LocalEstoque[];
  variantes: ResultadoVariante[];
  transferencias: SugestaoTransferencia[];
  config: ConfigDistribuicao;
  periodo: { inicio: string; fim: string };
  limitacoesGlobais: string[];
  somenteLeitura: true;
};

function chaveProduto(r: { produto: string | null; cod: string }): string {
  return r.produto ? r.produto.trim().toUpperCase() : `__sem_nome__${r.cod}`;
}

export function consolidarResultado(
  entrada: EntradaDistribuicao,
  estado: EstadoExecucao,
  config: ConfigDistribuicao = CONFIG_DISTRIBUICAO_PADRAO
): ResultadoDistribuicao {
  const porDiagnostico = Object.fromEntries(
    (Object.keys(DIAGNOSTICO_LABEL) as DiagnosticoVariante[]).map((d) => [d, 0])
  ) as Record<DiagnosticoVariante, number>;
  const porConfianca: Record<Confianca, number> = { ALTA: 0, MEDIA: 0, BAIXA: 0 };
  const produtosProblema = new Set<string>();
  let combinacoesProcessadas = 0;
  let variantesComInconsistencia = 0;
  const transferencias: SugestaoTransferencia[] = [];

  for (const r of estado.resultados) {
    porDiagnostico[r.diagnostico] += 1;
    porConfianca[r.confianca] += 1;
    combinacoesProcessadas += r.lojas.length;
    if (r.inconsistencias.length > 0) {
      variantesComInconsistencia += 1;
      produtosProblema.add(chaveProduto(r));
    }
    if (!r.produto || !r.grupo) produtosProblema.add(chaveProduto(r));
    transferencias.push(...r.transferencias);
  }
  for (const f of estado.falhas) {
    const v = entrada.variantes.find((x) => x.cod === f.cod);
    if (v) produtosProblema.add(chaveProduto(v));
  }

  const locaisAnalisados = entrada.locais.filter((l) => l.papel !== "EXCLUIDO").length;
  const variantesUnicas = new Set(entrada.variantes.map((v) => v.cod)).size;
  const produtosUnicos = new Set(entrada.variantes.map(chaveProduto)).size;
  const combinacoesEsperadas = variantesUnicas * locaisAnalisados;
  const variantesProcessadas = estado.resultados.length;
  const variantesComFalha = estado.falhas.length;
  const variantesPendentes = Math.max(estado.totalEsperado - variantesProcessadas - variantesComFalha, 0);

  const contagens: ContagensDistribuicao = {
    produtosUnicos,
    variantesUnicas,
    locaisAnalisados,
    locaisExcluidos: entrada.locais.length - locaisAnalisados,
    combinacoesEsperadas,
    combinacoesProcessadas,
    variantesProcessadas,
    variantesComFalha,
    variantesPendentes,
    conclusivas: estado.resultados.filter((r) => r.conclusivo).length,
    dadosInsuficientes: porDiagnostico.DADOS_INSUFICIENTES,
    naoAplicaveis: porDiagnostico.NAO_APLICAVEL,
    porDiagnostico,
    porConfianca,
    variantesComInconsistencia,
    produtosComDadosAusentesOuInconsistentes: produtosProblema.size,
    transferenciasSugeridas: transferencias.length,
    unidadesTransferiveis: transferencias.reduce((s, t) => s + t.quantidade, 0),
    reconciliado:
      variantesPendentes === 0 &&
      variantesProcessadas + variantesComFalha === variantesUnicas &&
      variantesUnicas === estado.totalEsperado &&
      // Variantes com falha não têm combinações processadas — o esperado delas sai da conta.
      combinacoesProcessadas === (variantesUnicas - variantesComFalha) * locaisAnalisados,
  };

  const fim = entrada.referencia;
  const inicio = new Date(fim.getTime() - config.janelaDemandaDias * DIA_MS);
  return {
    execucao: estado,
    contagens,
    locais: entrada.locais,
    variantes: estado.resultados,
    transferencias,
    config,
    periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
    limitacoesGlobais: entrada.limitacoesGlobais ?? [],
    somenteLeitura: true,
  };
}

// Atalho: executa o universo inteiro (todos os lotes) e consolida.
export function executarAnaliseDistribuicao(
  entrada: EntradaDistribuicao,
  config: ConfigDistribuicao = CONFIG_DISTRIBUICAO_PADRAO
): ResultadoDistribuicao {
  const estado = processarLotes(entrada, iniciarExecucao(entrada), config);
  return consolidarResultado(entrada, estado, config);
}

// ---------------------------------------------------------------------------
// MONTAGEM DO UNIVERSO A PARTIR DAS LINHAS DO BANCO (pura — a query fica em -dados.ts)
// ---------------------------------------------------------------------------

export type LinhaEstoque = {
  storeId: string;
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  quantidade: number;
  quantidadeReservada?: number | null;
  valorCusto: number | null;
};

export type LinhaMovimento = {
  storeId: string;
  cod: string;
  produto: string | null;
  grupo: string | null;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  vendas30: number;
  vendas60: number;
  vendas90: number;
  brindes90: number;
  canceladas90: number;
  ultimaVendaJanela: Date | null;
};

export type LinhaDevolucao = { storeId: string; cod: string; devolucoes30: number; devolucoes60: number; devolucoes90: number };
export type LinhaBrinde = { storeId: string; cod: string; brindes90: number };
export type LinhaUltimaVenda = { storeId: string; cod: string; ultimaVenda: Date };
export type LinhaPrimeiraAparicao = { cod: string; data: Date };
export type LojaBase = { id: string; name: string; sellsProducts: boolean; displayGroup?: string | null };

export type FontesDistribuicao = {
  lojas: LojaBase[];
  estoque: LinhaEstoque[];
  movimentos: LinhaMovimento[];
  devolucoes: LinhaDevolucao[];
  brindes: LinhaBrinde[];
  ultimasVendas: LinhaUltimaVenda[];
  primeirasAparicoes: LinhaPrimeiraAparicao[];
  // SKUs (IdGradeProduto) do catálogo de preços do DAPIC (/tabelaprecos, cache PriceCatalogCache)
  // — a única lista "cadastral" de SKUs que o Radar tem. Entra no universo mesmo sem estoque nem
  // venda, pra nenhum SKU cadastrado ficar de fora sem ser contado.
  codsCatalogoPrecos: string[];
};

// Une todas as fontes num universo de variantes com chave estável (cod). Decide também o papel de
// cada local: sellsProducts=false => EXCLUIDO (defeito/lixeira/...); vende mas sem nenhuma venda na
// janela pra produto nenhum => DEPOSITO; resto => PONTO_VENDA.
export function montarUniverso(f: FontesDistribuicao): { variantes: VarianteCatalogo[]; locais: LocalEstoque[] } {
  const lojasComVenda = new Set(f.movimentos.filter((m) => m.vendas90 > 0).map((m) => m.storeId));
  const locais: LocalEstoque[] = [...f.lojas]
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((l): LocalEstoque => {
      const base = { storeId: l.id, nome: l.name, grupoLocal: l.displayGroup ?? null };
      if (!l.sellsProducts) {
        return { ...base, papel: "EXCLUIDO", motivoPapel: "Armazenador fora de venda (defeito, lixeira, bonificação, conserto etc.)." };
      }
      if (!lojasComVenda.has(l.id)) {
        return { ...base, papel: "DEPOSITO", motivoPapel: "Nenhuma venda registrada na janela para nenhum produto — tratado como depósito." };
      }
      return { ...base, papel: "PONTO_VENDA", motivoPapel: "Local com vendas registradas na janela." };
    });

  type Acum = VarianteCatalogo & { fatos: Map<string, FatosLojaVariante>; custos: number[] };
  const porCod = new Map<string, Acum>();
  function variante(cod: string): Acum {
    let v = porCod.get(cod);
    if (!v) {
      v = { cod, produto: null, grupo: null, cor: null, tamanho: null, colecao: null, primeiraAparicao: null, fontes: [], lojas: [], custoUnitario: null, fatos: new Map(), custos: [] };
      porCod.set(cod, v);
    }
    return v;
  }
  function fatos(v: Acum, storeId: string): FatosLojaVariante {
    let x = v.fatos.get(storeId);
    if (!x) {
      x = { storeId, estoqueFisico: null, estoqueReservado: null, vendas30: 0, vendas60: 0, vendas90: 0, devolucoes30: 0, devolucoes60: 0, devolucoes90: 0, brindes90: 0, canceladas90: 0, ultimaVenda: null };
      v.fatos.set(storeId, x);
    }
    return x;
  }
  function fonte(v: Acum, nome: string) {
    if (!v.fontes.includes(nome)) v.fontes.push(nome);
  }

  // Estoque primeiro: é a fonte cadastral mais completa (nome/grupo/cor/tamanho/coleção).
  for (const e of f.estoque) {
    const v = variante(e.cod);
    fonte(v, "estoque");
    v.produto ??= e.produto;
    v.grupo ??= e.grupo;
    v.cor ??= e.cor;
    v.tamanho ??= e.tamanho;
    v.colecao ??= e.colecao;
    const x = fatos(v, e.storeId);
    x.estoqueFisico = (x.estoqueFisico ?? 0) + e.quantidade;
    if (e.quantidadeReservada != null) x.estoqueReservado = (x.estoqueReservado ?? 0) + e.quantidadeReservada;
    if (e.valorCusto != null && e.valorCusto > 0) v.custos.push(e.valorCusto);
  }
  for (const m of f.movimentos) {
    const v = variante(m.cod);
    fonte(v, "vendas");
    v.produto ??= m.produto;
    v.grupo ??= m.grupo;
    v.cor ??= m.cor;
    v.tamanho ??= m.tamanho;
    v.colecao ??= m.colecao;
    const x = fatos(v, m.storeId);
    x.vendas30 += m.vendas30;
    x.vendas60 += m.vendas60;
    x.vendas90 += m.vendas90;
    x.brindes90 += m.brindes90;
    x.canceladas90 += m.canceladas90;
    if (m.ultimaVendaJanela && (!x.ultimaVenda || m.ultimaVendaJanela > x.ultimaVenda)) x.ultimaVenda = m.ultimaVendaJanela;
  }
  for (const d of f.devolucoes) {
    const v = variante(d.cod);
    fonte(v, "devolucoes");
    const x = fatos(v, d.storeId);
    x.devolucoes30 += d.devolucoes30;
    x.devolucoes60 += d.devolucoes60;
    x.devolucoes90 += d.devolucoes90;
  }
  for (const b of f.brindes) {
    const v = variante(b.cod);
    fonte(v, "brindes");
    fatos(v, b.storeId).brindes90 += b.brindes90;
  }
  for (const u of f.ultimasVendas) {
    const v = porCod.get(u.cod);
    if (!v) continue; // venda antiga de SKU que não está em mais nenhuma fonte não cria variante sozinha
    const x = fatos(v, u.storeId);
    if (!x.ultimaVenda || u.ultimaVenda > x.ultimaVenda) x.ultimaVenda = u.ultimaVenda;
  }
  for (const cod of f.codsCatalogoPrecos) fonte(variante(cod), "catalogo-precos");
  const primeira = new Map(f.primeirasAparicoes.map((p) => [p.cod, p.data]));

  const variantes: VarianteCatalogo[] = [...porCod.values()].map((v) => ({
    cod: v.cod,
    produto: v.produto,
    grupo: v.grupo,
    cor: v.cor,
    tamanho: v.tamanho,
    colecao: v.colecao,
    primeiraAparicao: primeira.get(v.cod) ?? null,
    fontes: v.fontes,
    lojas: [...v.fatos.values()],
    custoUnitario: v.custos.length > 0 ? v.custos.reduce((s, c) => s + c, 0) / v.custos.length : null,
  }));
  return { variantes, locais };
}

// ---------------------------------------------------------------------------
// FILTRO E RANKING PARA A TELA (puro). O ranking só decide a ORDEM de exibição — o universo
// analisado é sempre o catálogo inteiro, e `total` informa quantas variantes casaram o filtro.
// ---------------------------------------------------------------------------

export type FiltroDistribuicao = {
  busca?: string;
  storeId?: string;
  grupo?: string;
  diagnostico?: DiagnosticoVariante;
  confianca?: Confianca;
  // Restrição de permissão: só variantes/transferências que envolvem estas lojas. undefined = todas.
  lojasPermitidas?: string[];
};

// Gravidade operacional pra ordenar (menor = aparece antes): primeiro o que tem ação possível
// (transferir), depois falta global e subalocação, excesso/parado, e por fim o que não pede ação.
const ORDEM_DIAGNOSTICO: Record<DiagnosticoVariante, number> = {
  TRANSFERENCIA_POSSIVEL: 0,
  ESTOQUE_TOTAL_INSUFICIENTE: 1,
  POSSIVEL_SUBALOCACAO: 2,
  POSSIVEL_EXCESSO: 3,
  ESTOQUE_PARADO: 4,
  DADOS_INSUFICIENTES: 5,
  EQUILIBRADA: 6,
  SEM_ESTOQUE_SEM_DEMANDA: 7,
  NAO_APLICAVEL: 8,
};

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function envolveLoja(v: ResultadoVariante, ids: Set<string>): boolean {
  return v.lojas.some(
    (l) => ids.has(l.storeId) && (l.estoqueFisico > 0 || l.vendasLiquidas90 !== 0 || l.devolucoes90 > 0)
  );
}

export function filtrarVariantes(variantes: ResultadoVariante[], f: FiltroDistribuicao): ResultadoVariante[] {
  const termos = f.busca ? normalizar(f.busca).split(/\s+/).filter(Boolean) : [];
  const permitidas = f.lojasPermitidas ? new Set(f.lojasPermitidas) : null;
  return variantes
    .filter((v) => {
      if (permitidas && !envolveLoja(v, permitidas)) return false;
      if (f.storeId && !envolveLoja(v, new Set([f.storeId]))) return false;
      if (f.grupo && v.grupo !== f.grupo) return false;
      if (f.diagnostico && v.diagnostico !== f.diagnostico) return false;
      if (f.confianca && v.confianca !== f.confianca) return false;
      if (termos.length > 0) {
        const texto = normalizar([v.cod, v.produto, v.grupo, v.cor, v.tamanho, v.colecao].filter(Boolean).join(" "));
        if (!termos.every((t) => texto.includes(t))) return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        ORDEM_DIAGNOSTICO[a.diagnostico] - ORDEM_DIAGNOSTICO[b.diagnostico] ||
        b.unidadesTransferiveis - a.unidadesTransferiveis ||
        b.maiorDesequilibrio - a.maiorDesequilibrio ||
        b.vendasLiquidas90 - a.vendasLiquidas90 ||
        (a.cod < b.cod ? -1 : a.cod > b.cod ? 1 : 0)
    );
}

export function filtrarTransferencias(transferencias: SugestaoTransferencia[], variantesFiltradas: ResultadoVariante[], f: FiltroDistribuicao): SugestaoTransferencia[] {
  const cods = new Set(variantesFiltradas.map((v) => v.cod));
  const permitidas = f.lojasPermitidas ? new Set(f.lojasPermitidas) : null;
  return transferencias
    .filter((t) => cods.has(t.cod))
    .filter((t) => !permitidas || permitidas.has(t.origem.storeId) || permitidas.has(t.destino.storeId))
    .filter((t) => !f.storeId || t.origem.storeId === f.storeId || t.destino.storeId === f.storeId)
    .sort(
      (a, b) =>
        (a.destino.coberturaAntesDias ?? 0) - (b.destino.coberturaAntesDias ?? 0) ||
        b.quantidade - a.quantidade ||
        a.id.localeCompare(b.id)
    );
}

export { nomeVariante };
