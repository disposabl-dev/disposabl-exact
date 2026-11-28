import { readFileSync } from "node:fs";

export function sandboxSession() {
  if (process.platform !== "linux") return null;
  try {
    const { origin, token, expiresAt } = JSON.parse(readFileSync("/dev/shm/disposabl/session.json", "utf8"));
    if (typeof origin !== "string" || !Number.isFinite(expiresAt) || Date.now() >= expiresAt || !/^dsp_sandbox_[a-f0-9]{64}$/.test(token)) return null;
    return { origin, token };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
