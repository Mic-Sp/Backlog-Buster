type SagaGame = {
  id: number;
  title: string;
  status: string;
  franchise?: string | null;
};

export type SagaChain = {
  key: string;
  name: string;
  total: number;
  completed: number;
  gameIds: number[];
};

const knownSeries: [RegExp, string][] = [
  [/^(?:the )?legend of zelda\b|^zelda\b/, "Legend of Zelda"],
  [/^final fantasy\b/, "Final Fantasy"],
  [/^resident evil\b/, "Resident Evil"],
  [/^batman arkham\b/, "Batman: Arkham"],
  [/^alan wakes?\b/, "Alan Wake"],
  [/^kingdom hearts\b/, "Kingdom Hearts"],
  [/^star wars jedi\b/, "Star Wars Jedi"],
  [/^(?:the )?witcher\b/, "The Witcher"],
  [/^mass effect\b/, "Mass Effect"],
  [/^assassins creed\b/, "Assassin's Creed"],
  [/^super mario\b/, "Super Mario"],
  [/^mario kart\b/, "Mario Kart"],
  [/^metroid\b/, "Metroid"],
  [/^the last of us\b/, "The Last of Us"],
  [/^yakuza\b|^like a dragon\b/, "Yakuza / Like a Dragon"],
];

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function getSagaName(game: Pick<SagaGame, "title" | "franchise">): string | null {
  const manual = game.franchise?.trim().replace(/\s+/g, " ");
  if (manual) return manual;
  const normalizedTitle = normalize(game.title);
  const known = knownSeries.find(([pattern]) => pattern.test(normalizedTitle));
  if (known) return known[1];

  const stem = game.title.split(/[:：]|\s[-–—]\s/)[0]
    .replace(/\s+(?:\d+(?:\.\d+)?|xviii|xvii|xvi|xv|xiv|xiii|xii|xi|ix|viii|vii|vi|iv|iii|ii|xx|x|v|i)\b.*$/i, "")
    .replace(/\s+(?:(?:the )?(?:definitive|complete|ultimate|game of the year|goty) edition|remastered|remake)\s*$/i, "")
    .trim();
  return normalize(stem).length >= 2 ? stem : null;
}

export function buildSagaChains(games: readonly SagaGame[]) {
  const groups = new Map<string, SagaChain & { hasManualName: boolean }>();
  for (const game of games) {
    const name = getSagaName(game);
    if (!name) continue;
    const key = normalize(name);
    if (!key) continue;
    const manual = Boolean(game.franchise?.trim());
    let group = groups.get(key);
    if (!group) {
      group = { key, name, total: 0, completed: 0, gameIds: [], hasManualName: manual };
      groups.set(key, group);
    } else if (manual && !group.hasManualName) {
      group.name = name;
      group.hasManualName = true;
    }
    group.total++;
    if (game.status === "Completed") group.completed++;
    group.gameIds.push(game.id);
  }
  const chains: SagaChain[] = [...groups.values()].filter((group) => group.total >= 2)
    .map(({ key, name, total, completed, gameIds }) => ({ key, name, total, completed, gameIds }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const byGameId = new Map<number, SagaChain>();
  for (const chain of chains) for (const id of chain.gameIds) byGameId.set(id, chain);
  return { chains, byGameId };
}
