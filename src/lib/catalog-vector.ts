import { createHash } from "node:crypto";

export const CATALOG_VECTOR_DIMENSIONS = 128;
// Changing normalization, hashing, segment layout or weights requires a new version + backfill.
export const CATALOG_VECTOR_VERSION = "catalog-features-v1";
export type CatalogVectorInput = {
  genres?: readonly string[]; genre?: string | null; tags?: readonly string[];
  seriesHints?: readonly string[]; estimatedHours?: number | null; releaseYear?: number | null;
};

export function normalizeFeature(value: string): string {
  const clean = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return ({ "role playing": "rpg", "role playing games": "rpg", "co operative": "coop", "co op": "coop" } as Record<string, string>)[clean] ?? clean;
}

export function normalizeFeatureList(values: readonly string[]): string[] {
  return [...new Set(values.filter(value => typeof value === "string").map(normalizeFeature).filter(Boolean))].sort();
}

/** Reject malformed/non-finite vectors and zero vectors (cosine distance is undefined). */
export function normalizeVector(values: readonly number[], dimensions = CATALOG_VECTOR_DIMENSIONS): number[] {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || values.length !== dimensions || values.some(value => !Number.isFinite(value))) throw new Error("Invalid embedding dimensions or values.");
  const scale = Math.max(...values.map(Math.abs));
  if (!scale) throw new Error("Cannot normalize a zero embedding.");
  const scaled = values.map(value => value / scale);
  const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0));
  return scaled.map(value => value / norm);
}

function bucket(value: string, size: number): number {
  // FNV-1a over Unicode code points; Math.imul fixes 32-bit multiplication across runtimes.
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  return hash % size;
}

function numeric(value: number | null | undefined, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.max(min, Math.min(max, value)) : null;
}

export function buildCatalogVector(input: CatalogVectorInput) {
  const features = {
    genres: normalizeFeatureList([...(input.genres ?? []), ...(input.genre ? [input.genre] : [])]),
    tags: normalizeFeatureList(input.tags ?? []), seriesHints: normalizeFeatureList(input.seriesHints ?? []),
    estimatedHours: numeric(input.estimatedHours, 1, 10000),
    releaseYear: numeric(input.releaseYear, 1970, 2030),
  };
  const vector = Array<number>(CATALOG_VECTOR_DIMENSIONS).fill(0);
  function categorical(values: string[], offset: number, size: number, weight: number) {
    for (const value of values) vector[offset + bucket(value, size)] += 1;
    const norm = Math.sqrt(vector.slice(offset, offset + size).reduce((sum, value) => sum + value * value, 0));
    if (norm) for (let index = offset; index < offset + size; index++) vector[index] *= weight / norm;
  }
  // Isolated segments prevent a tag hash collision from masquerading as a genre/series.
  categorical(features.genres, 0, 32, 3);
  categorical(features.tags, 32, 48, 2);
  categorical(features.seriesHints, 80, 32, 2);
  function continuous(value: number | null, offset: number, weight: number) {
    if (value === null) { vector[offset] = weight; return; } // Dedicated unknown bin.
    const position = 1 + value * 6;
    const lower = Math.floor(position), upper = Math.min(7, lower + 1);
    vector[offset + lower] += weight * (1 - (position - lower));
    vector[offset + upper] += weight * (position - lower);
  }
  continuous(features.estimatedHours === null ? null : Math.log1p(features.estimatedHours) / Math.log1p(10000), 112, 1);
  continuous(features.releaseYear === null ? null : (features.releaseYear - 1970) / 60, 120, 0.75);
  return {
    values: normalizeVector(vector), dimensions: CATALOG_VECTOR_DIMENSIONS, version: CATALOG_VECTOR_VERSION,
    contentHash: createHash("sha256").update(JSON.stringify(features)).digest("hex"),
  };
}

export function vectorLiteral(values: readonly number[]): string {
  if (values.length !== CATALOG_VECTOR_DIMENSIONS || values.some(value => !Number.isFinite(value)) || !values.some(value => value !== 0)) {
    throw new Error("Invalid catalog vector.");
  }
  return `[${values.join(",")}]`;
}

/** Future semantic adapters get public metadata only; never compare their space with v1 feature vectors. */
export type SemanticEmbeddingProvider = {
  model: string;
  dimensions: number;
  embed: (publicDescription: string) => Promise<readonly number[]>;
};
