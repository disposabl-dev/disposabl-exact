"use node";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ConvexError } from "convex/values";
import { env } from "../../_generated/server";

function encryptionKey() {
  const key = Buffer.from(env.CONNECTIONS_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new ConvexError("Convex connections are not configured.");
  return key;
}

export function encryptConvexToken(token: string, userId: string, teamId: number) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${userId}:convex:${teamId}`));
  return Buffer.concat([iv, cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}

export function decryptConvexToken(token: string, userId: string, teamId: number) {
  try {
    const packed = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${userId}:convex:${teamId}`));
    decipher.setAuthTag(packed.subarray(-16));
    return Buffer.concat([decipher.update(packed.subarray(12, -16)), decipher.final()]).toString("utf8");
  } catch {
    throw new ConvexError("Reconnect Convex before creating the app.");
  }
}
