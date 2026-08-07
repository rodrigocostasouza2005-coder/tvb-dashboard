// Aviso de atualização via bot do Telegram (t.me/Dashboard_TVBot).
// Se um dia trocar pra WhatsApp, só essa função precisa mudar — quem chama não sabe o canal.

export async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // aviso é best-effort, não deve derrubar a sync

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // não interrompe a sync se o aviso falhar
  }
}
