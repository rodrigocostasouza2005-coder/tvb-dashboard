// Aviso de atualização via bot do Telegram (t.me/Dashboard_TVBot).
// Se um dia trocar pra WhatsApp, só essa função precisa mudar — quem chama não sabe o canal.
//
// TELEGRAM_CHAT_ID aceita 1 ou vários ids separados por vírgula ("111,222,333") — cada pessoa
// nova precisa mandar uma mensagem pro bot primeiro (Telegram não deixa bot iniciar conversa),
// só depois disso dá pra pegar o chat_id dela e adicionar na lista.

export async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_ID ?? "")
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
