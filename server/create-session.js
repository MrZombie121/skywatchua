import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const rl = readline.createInterface({ input, output });

const apiId = Number(await rl.question("TG_API_ID: "));
const apiHash = await rl.question("TG_API_HASH: ");
const phoneNumber = await rl.question("Phone number (with country code): ");

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 3
});

await client.start({
  phoneNumber: async () => phoneNumber,
  password: async () => await rl.question("2FA password (if any): "),
  phoneCode: async () => await rl.question("Code from Telegram: "),
  onError: (err) => console.error(err)
});

console.log("\nString session (save to TG_SESSION):");
console.log(client.session.save());

await client.disconnect();
rl.close();
