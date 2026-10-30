// Regras de mapeamento armazenador (DAPIC) -> Store (nosso banco).
// Centralizado aqui porque script de sync e a rota /api/sync precisam da mesma lógica.

// Armazenadores de "defeito", lixeira, bonificação, marketing/produção, extraviados (perda de
// estoque, achado em 2026-09-25) e conserto (achado em 2026-10-27 — mesma classe de bug: o DAPIC
// criou esse armazenador novo e, como não batia com nenhum termo daqui, sellsProducts() tratava
// como loja de venda. Pior ainda: por vir ANTES de "CD" na lista de /armazenadores, "roubava" o
// primaryStoreId em syncArmazenadores (`if (sells && !primaryStoreId) primaryStoreId = store.id`
// pega o PRIMEIRO que vende, não especificamente o CD) — toda venda real do Site (via /faturas)
// desde então foi gravada silenciosamente na loja "Conserto", sem erro nenhum, só saleDate real
// mas no storeId errado. Ver scripts/corrigir-storeid-conserto.ts pro reparo do dado já gravado
// errado; esse regex só evita achar NOVO armazenador assim de novo — não é proteção genérica
// contra qualquer nome futuro.
const NAO_VENDE = /defeito|lixeira|bonifica|marketing|extravia|conserto/i;

// Agrupamento só visual (pro filtro mostrar uma opção só) — os dados continuam em Stores
// separadas por baixo, porque CD e ATACADO têm quantidades diferentes pro mesmo produto
// (juntar de verdade faria uma sobrescrever a outra em vez de somar).
const DISPLAY_GROUP: Record<string, string> = {
  CD: "TVB Site e Atacado",
  ATACADO: "TVB Site e Atacado",
};

export function displayGroupFor(descricao: string): string | null {
  return DISPLAY_GROUP[descricao] ?? null;
}

export function sellsProducts(descricao: string): boolean {
  return !NAO_VENDE.test(descricao);
}

// Âncora pra primaryStoreId (ver syncArmazenadores em sync-runner.ts) — achado em 2026-10-30,
// causa raiz real do incidente do armazém "Conserto": a regra antiga escolhia "o primeiro
// armazenador que vende, na ordem que a API devolveu", não especificamente o CD. Quando um
// armazém novo não reconhecido pelo NAO_VENDE veio antes de "CD" na resposta, ele roubou o
// primaryStoreId e toda venda real do Site foi gravada no lugar errado por 5 dias, sem erro
// nenhum. Daqui pra frente, pros tokens listados aqui, primaryStoreId é sempre o Store cujo code
// bate com o valor configurado — nunca "o primeiro que vende" por acidente de ordenação.
export const PRIMARY_STORE_CODE_BY_CLIENT_LABEL: Record<string, string> = {
  "cd-atacado": "CD",
};
