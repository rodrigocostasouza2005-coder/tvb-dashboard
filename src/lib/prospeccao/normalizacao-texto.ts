/**
 * Normalização de texto compartilhada pelo motor de elegibilidade/pontuação e pela detecção de
 * duplicatas (rebuild do núcleo de prospecção, 2026-11). Uma única função pequena, sem estado,
 * usada em todo lugar que precisa comparar texto "pra humano" (nome de marca, nome fantasia,
 * endereço) de forma tolerante a maiúscula/minúscula, acento e espaçamento — sem isso "Nike" e
 * "nike " ou "Reserva" e "RESERVA" contariam como marcas/nomes diferentes.
 */
export function normalizarChave(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
