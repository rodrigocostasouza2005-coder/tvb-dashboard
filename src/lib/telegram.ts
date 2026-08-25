// Aviso de atualização via bot do Telegram (t.me/Dashboard_TVBot).
// Se um dia trocar pra WhatsApp, só essa função precisa mudar — quem chama não sabe o canal.
//
// TELEGRAM_CHAT_ID aceita 1 ou vários ids separados por vírgula ("111,222,333") — cada pessoa
// nova precisa mandar uma mensagem pro bot primeiro (Telegram não deixa bot iniciar conversa),
// só depois disso dá pra pegar o chat_id dela e adicionar na lista.
//
// adminOnly manda só pro TELEGRAM_ADMIN_CHAT_ID (o Rodrigo) em vez da lista inteira — usado nas
// mensagens de erro das syncs (pedido do Rodrigo em 2026-08-24: só ele recebe erro, sucesso
// continua indo pra todo mundo). Se TELEGRAM_ADMIN_CHAT_ID não estiver configurado, cai pro
// TELEGRAM_CHAT_ID mesmo, pra não perder o aviso.
export async function sendTelegramMessage(text: string, opts: { adminOnly?: boolean } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const rawIds = opts.adminOnly
    ? (process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID) ?? ""
    : process.env.TELEGRAM_CHAT_ID ?? "";
  const chatIds = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!token || chatIds.length === 0) return; // aviso é best-effort, não deve derrubar a sync

  await Promise.all(
    chatIds.map((chatId) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).catch(() => {
        // não interrompe a sync se o aviso pra 1 pessoa falhar
      })
    )
  );
}
