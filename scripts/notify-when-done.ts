// Watcher: monitora /tmp/backfill-faturas.log e manda Telegram quando terminar.
// Uso: npx tsx scripts/notify-when-done.ts
import { readFileSync } from "fs";
import { sendTelegramMessage } from "../src/lib/telegram";

const LOG = "/tmp/backfill-faturas.log";
const INTERVAL_MS = 15_000; // checa a cada 15s

function readLog() {
  try { return readFileSync(LOG, "utf8"); } catch { return ""; }
}

async function check() {
  const log = readLog();
  if (log.includes("Done. Inserted")) {
    const match = log.match(/Done\. Inserted (\d+) new records \(of (\d+) items\)\./);
    const msg = match
      ? `✅ Backfill de faturas concluído!\nNovos registros inseridos: ${match[1]} de ${match[2]} itens.`
      : "✅ Backfill de faturas concluído!";
    console.log(msg);
    await sendTelegramMessage(msg);
    process.exit(0);
  }
  if (log.includes("Error") && !log.includes("faturas processed")) {
    const msg = "⚠️ Backfill de faturas falhou. Verifique /tmp/backfill-faturas.log.";
    console.log(msg);
    await sendTelegramMessage(msg);
    process.exit(1);
  }
}

console.log("Aguardando backfill terminar...");
setInterval(check, INTERVAL_MS);
