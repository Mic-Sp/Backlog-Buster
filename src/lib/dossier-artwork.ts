import "server-only";

import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { coalesce } from "@/lib/api-resilience";

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);

export function isPublicImageAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const [a, b] = address.toLowerCase().split(":").map(part => parseInt(part || "0", 16));
    // Global unicast only; exclude mapped/local, transition and documentation ranges.
    return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 && !(a === 0x2001 && (b < 0x200 || b === 0xdb8));
  }
  return false;
}

export function parseArtworkUrl(value: unknown): URL {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2048) throw new Error("Invalid artwork URL.");
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
      /(^|\.)(localhost|local|internal)$/i.test(url.hostname)) throw new Error("Use a public HTTP or HTTPS image URL.");
  url.hash = "";
  return url;
}

export async function fetchDossierArtwork(value: unknown): Promise<{ bytes: Buffer; contentType: string }> {
  const initial = parseArtworkUrl(value);
  return coalesce(`dossier-artwork:${initial.href}`, async () => {
    const signal = AbortSignal.timeout(6000);
    let url = initial;
    for (let redirects = 0; redirects <= 2; redirects++) {
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      // Validate ALL DNS answers and pin the socket to a checked address, preventing DNS rebinding.
      const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          if (signal.aborted) { reject(new Error("Artwork timed out.")); return; }
          signal.addEventListener("abort", () => reject(new Error("Artwork timed out.")), { once: true });
        }),
      ]);
      if (!addresses.length || addresses.some(entry => !isPublicImageAddress(entry.address))) throw new Error("Artwork host is not public.");
      const pinned = addresses.find(entry => entry.family === 4) ?? addresses[0];
      const pinnedLookup: LookupFunction = (_hostname, options, callback) => options.all
        ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family);
      const result = await new Promise<{ location: string } | { bytes: Buffer; contentType: string }>((resolve, reject) => {
        const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method: "GET", signal, agent: false, lookup: pinnedLookup,
          // Deliberately forward no cookies, authorization, or caller-supplied headers.
          headers: { Accept: "image/png,image/jpeg,image/webp,image/avif,image/gif", "Accept-Encoding": "identity" },
        }, response => {
          const status = response.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            resolve({ location: response.headers.location }); response.destroy(); return;
          }
          const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
          if (status !== 200 || !IMAGE_TYPES.has(contentType) || Number(response.headers["content-length"]) > MAX_BYTES) {
            reject(new Error("Artwork is unavailable or unsupported.")); response.destroy(); return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) { reject(new Error("Artwork is too large.")); response.destroy(); }
            else chunks.push(chunk);
          });
          response.on("end", () => size > 0 ? resolve({ bytes: Buffer.concat(chunks), contentType }) : reject(new Error("Empty artwork.")));
          response.on("error", reject);
          response.on("aborted", () => reject(new Error("Artwork transfer interrupted.")));
        });
        request.on("error", reject);
        request.end();
      });
      if ("bytes" in result) return result;
      // Revalidate both URL and DNS on every redirect; never follow into private networks.
      url = parseArtworkUrl(new URL(result.location, url).href);
    }
    throw new Error("Too many artwork redirects.");
  });
}
