import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const rl = readline.createInterface({ input, output });

async function ask(label, fallback = "") {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = await rl.question(`${label}${suffix}: `);
  return String(answer || fallback || "").trim();
}

const apiIdInput = await ask("TG_API_ID", process.env.TG_API_ID || "");
const apiHash = await ask("TG_API_HASH", process.env.TG_API_HASH || "");
const phoneNumber = await ask("Phone number (with country code)", process.env.TG_PHONE || "");
const apiId = Number(apiIdInput);

if (!Number.isFinite(apiId) || !apiHash || !phoneNumber) {
  console.error("TG_API_ID, TG_API_HASH and TG_PHONE are required.");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 3
});

await client.start({
  phoneNumber: async () => phoneNumber,
  password: async () => await ask("2FA password (if any)", process.env.TG_PASSWORD || ""),
  phoneCode: async () => await ask("Code from Telegram", process.env.TG_CODE || ""),
  onError: (err) => console.error(err)
});

console.log("\nString session (save to TG_SESSION):");
console.log(client.session.save());

await client.disconnect();
rl.close();
