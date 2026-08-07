// Regras de mapeamento armazenador (DAPIC) -> Store (nosso banco).
// Centralizado aqui porque script de sync e a rota /api/sync precisam da mesma lógica.

// Armazenadores de "defeito", lixeira, bonificação e marketing/produção não são loja de venda.
const NAO_VENDE = /defeito|lixeira|bonifica|marketing/i;

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
