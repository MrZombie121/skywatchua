import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const childProcesses = [];
let shuttingDown = false;

function spawnProcess(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    windowsHide: false
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const details = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[dev] ${name} exited with ${details}`);
    shutdown(typeof code === "number" ? code : 1);
  });

  child.on("error", (error) => {
    if (shuttingDown) return;
    console.error(`[dev] Failed to start ${name}:`, error.message || error);
    shutdown(1);
  });

  childProcesses.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of childProcesses) {
    if (child.killed) continue;
    try {
      child.kill("SIGTERM");
    } catch {}
  }

  setTimeout(() => {
    for (const child of childProcesses) {
      if (child.killed) continue;
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    process.exit(exitCode);
  }, 1200).unref();

  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

spawnProcess("backend", "node", ["server/index.js"]);
spawnProcess("vite", isWindows ? "npm.cmd" : "npm", ["run", "dev:client"]);
