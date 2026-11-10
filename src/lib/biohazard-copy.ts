import type { ThemeTermKey } from "@/lib/custom-theme";

const terms: Partial<Record<ThemeTermKey, string>> = {
  workspaceTitle: "Safe Room", libraryTitle: "Item Box", statsTitle: "Operative status", inventoryTitle: "Item Box",
  deckTitle: "Equipped loadout", authTitle: "Personnel access", scoutTitle: "Field Recon / High-Threat Files",
  scoutSearchTitle: "External Scout", releaseRadarTitle: "Outbreak Radar", popularFeedTitle: "High-Threat Files",
  alongInterestsTitle: "Matched to your field record", highTasteMatchTitle: "Priority match", sagaFollowTitle: "Related incident",
};
const phrases: Record<string, string> = {
  "Netrunner Telemetry & Critic Matrix": "Field records & ratings",
  "Cyan: share of": "First bar: share of", "across the library. Gold: completion within each group.": "across the library. Second bar: completion within each group.",
  "Your curated collections": "Lab research folders", "DATA SHARDS // CUSTOM QUEUES": "CLASSIFIED / CUSTOM RESEARCH FOLDERS",
  "🪪 NETRUNNER DOSSIER": "PERSONNEL FILE / TROPHIES", "Netrunner Dossier": "Personnel file", "Close Netrunner dossier": "Close personnel file",
  "🧠 CORTEX // ADVISE NEXT GIG": "FIELD RECON / OUTBREAK RADAR", "CORTEX // TACTICAL GIG ADVISOR": "Field Recon / Outbreak Radar",
  "BACKLOG INTELLIGENCE // EXTERNAL SCOUT ONLINE": "BIO-RESEARCH / EXTERNAL SCOUT ONLINE",
  "RELEASE RADAR // MARKET TELEMETRY": "OUTBREAK RADAR / NEW & UPCOMING",
  "POPULAR / TRENDING // MARKET TELEMETRY": "HIGH-THREAT FILES / POPULAR & TRENDING",
  "Data Vault": "Archive transfer", "Close Data Vault": "Close archive transfer",
  "🎲 ROLL RANDOM GIG": "RANDOM ASSIGNMENT", "Backlog Roulette": "Random assignment", "SIDE JOB / RANDOM QUEST GENERATOR": "OPERATIONS / RANDOM ASSIGNMENT",
  "SOCIAL HUB": "RADIO / SOCIAL HUB", "Social Hub": "Radio / Social Hub", "YOUR CREW // YOUR NEXT SESSION": "SURVIVOR NETWORK / SECURE CHANNEL",
  "ICE SECURITY GATEWAY // OPERATOR CREDENTIALS": "Security checkpoint / Operative credentials",
  "Netrunner Access": "Personnel access", "ICE GATEWAY // OPERATOR AUTHENTICATION": "SECURITY CHECKPOINT / PERSONNEL AUTHENTICATION",
  "📌 PIN TO DECK": "EQUIP", "📌 PINNED": "EQUIPPED", "✕ UNPIN": "STORE",
  "Upcoming gigs cannot be pinned.": "Unreleased games cannot be equipped.", "Deck full (3/3). Unpin a gig to make room.": "All three quick slots are occupied. Store an equipped game to make room.",
  "Neon accent": "Personnel file accent", "ANONYMOUS NETRUNNER": "UNIDENTIFIED OPERATIVE", "night-city-runner": "safe-room-operative",
};

/** Shared functional surfaces keep neutral copy; persona terms resolve centrally. */
export function biohazardCopy(source: string, term?: ThemeTermKey) {
  if (term && terms[term]) return terms[term]!;
  if (phrases[source]) return phrases[source];
  return source.replace(/Netrunner/gi, "Operative").replace(/CORTEX/g, "RECON").replace(/NEURAL NET/g, "PERIMETER").replace(/\bGIGS\b/g, "OPERATIONS").replace(/\bGIG\b/g, "OPERATION").replace(/\bgigs\b/g, "games").replace(/\bgig\b/g, "game").replace(/\bCONTRACTS\b/g, "INCIDENT FILES").replace(/DATA SHARDS/g, "RESEARCH FILES").replace(/MARKET TELEMETRY/g, "FIELD REPORTS");
}
