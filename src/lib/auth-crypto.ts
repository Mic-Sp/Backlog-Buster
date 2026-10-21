import "server-only";

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const cost = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const prefix = "scrypt$131072$8$1";

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, cost, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${prefix}$${salt.toString("hex")}$${key.toString("hex")}`;
}

// Use the same expensive derivation for unknown accounts to avoid a cheap lookup oracle.
const dummyHash = `${prefix}$${"00".repeat(16)}$${"00".repeat(64)}`;
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const encoded = stored ?? dummyHash;
  const parts = encoded.split("$");
  if (parts.slice(0, 4).join("$") !== prefix || parts.length !== 6 ||
      !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const actual = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(actual, Buffer.from(parts[5], "hex")) && stored !== null;
}

export function sessionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function signSessionToken(token: string, secret: Buffer): string {
  const payload = `v1.${token}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifySessionToken(cookie: string, secret: Buffer): string | null {
  const match = /^v1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(cookie);
  if (!match) return null;
  const expected = signSessionToken(match[1], secret).split(".")[2];
  if (!timingSafeEqual(Buffer.from(match[2]), Buffer.from(expected))) return null;
  return sessionTokenHash(match[1]);
}
