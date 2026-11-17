import type { ThemeTermKey } from "@/lib/custom-theme";

export const standardTerms: Record<ThemeTermKey, string> = {
  workspaceTitle: "Backlog Buster", libraryTitle: "Game Library", statsTitle: "Player Stats", inventoryTitle: "Games",
  deckTitle: "Up Next", authTitle: "Sign In", scoutTitle: "Discover Games", scoutSearchTitle: "Search Games",
  releaseRadarTitle: "New & Upcoming", popularFeedTitle: "Popular & Trending", alongInterestsTitle: "Based on Your Interests",
  highTasteMatchTitle: "Matches Your Taste", sagaFollowTitle: "Related Games",
};
const phrases: Record<string, string> = {
  "System Playqueue": "Game Library", "Library inventory": "Games", "Inventory": "Games", "Item Box": "Games",
  "Equipped loadout": "Up Next", "On Deck // Up Next": "Up Next", "Operator stats": "Player Stats",
  "Initialize Game Entry": "Add Game", "Edit Game Metadata": "Edit Game", "RECORD // METADATA EDITOR": "Edit Game",
  "SAVE METADATA": "Save Changes", "Data Vault": "Import & Export", "Close Data Vault": "Close Import & Export",
  "LOCAL ARCHIVE // LIBRARY TRANSFER": "Import & Export", "01 // EXPORT BACKUP": "Export Library", "02 // IMPORT & SYNC": "Import Games",
  "🎲 ROLL RANDOM GIG": "Random Game Picker", "Backlog Roulette": "Random Game Picker", "Close Backlog Roulette": "Close Random Game Picker",
  "SIDE JOB / RANDOM QUEST GENERATOR": "Choose a Game", "ROLL RANDOM GIG": "Pick a Random Game", "SCANNING GIGS…": "Picking a Game…",
  "GIG FOUND": "Selected Game", "ACCEPT GIG": "Start Playing", "Set your limits. Let the next gig find you.": "Filter your backlog and pick a random game to play.",
  "🧠 CORTEX // ADVISE NEXT GIG": "AI Recommendations", "CORTEX // TACTICAL GIG ADVISOR": "AI Recommendations",
  "BACKLOG INTELLIGENCE // EXTERNAL SCOUT ONLINE": "Recommendations & Discovery", "SCANNING LIBRARY // CALIBRATING NEXT GIG…": "Loading Recommendations…",
  "🔗 AFFINITY // FAVORITES MATCH": "Similar to Your Favorites", "⚡ PALETTE CLEANSER // PACING RESET": "Try Something Different",
  "TACTICAL ASSESSMENT": "Why This Game", "ACQUISITION RATIONALE": "Why This Game", "▶ START GIG NOW": "Start Playing",
  "REFRESH SCAN": "Refresh Recommendations", "RETRY SCAN": "Retry", "RETRY EXTERNAL SCAN": "Retry Search", "RESCAN NEW CONTRACTS": "Find More Games",
  "CORTEX // EXTERNAL SCOUT ONLINE": "Searching Games", "SCANNING NEURAL NET // SEARCHING FOR COMPATIBLE CONTRACTS...": "Searching for Recommended Games…",
  "SCANNING NEURAL NET…": "Searching…", "⚡ OVERRIDE LOCK & SCAN": "Discover More Games", "ADDING CONTRACT…": "Adding Game…",
  "02 // EXTERNAL SCOUT (NEW CONTRACTS)": "Discover Games", "RELEASE RADAR // MARKET TELEMETRY": "New & Upcoming Games",
  "POPULAR / TRENDING // MARKET TELEMETRY": "Popular & Trending Games", "ALONG YOUR INTERESTS": "Based on Your Interests",
  "Netrunner Telemetry & Critic Matrix": "Library Stats & Ratings", "01 // SYSTEM TELEMETRY": "Library Stats",
  "Cyan: share of": "First bar: share of", "across the library. Gold: completion within each group.": "across the library. Second bar: completion within each group.",
  "DATA SHARDS // CUSTOM QUEUES": "Custom Lists", "Your curated collections": "Your Lists", "PUBLIC DATA SHARDS": "Public Lists",
  "SOCIAL HUB": "Friends", "Social Hub": "Friends", "YOUR CREW // YOUR NEXT SESSION": "Friends & Activity", "CONNECTED BY PLAY": "Play Together",
  "🪪 NETRUNNER DOSSIER": "Player Profile", "Netrunner Dossier": "Player Profile", "Close Netrunner dossier": "Close Player Profile",
  "Netrunner Access": "Sign In", "ICE GATEWAY // OPERATOR AUTHENTICATION": "Account Access", "ARCHIVE LOCKED // IDENTIFY YOURSELF": "Sign In to Your Library",
  "Sign in to your private library, or register a new operator with an empty archive.": "Sign in to your game library or create an account.",
  "REGISTER // NEW ARCHIVE": "Create Account", "REGISTER // CLAIM ARCHIVE": "Create Account", "▶ SIGN IN": "Sign In",
  "⚡ CREATE NETRUNNER ACCOUNT": "Create Account", "⚡ CREATE ACCOUNT & CLAIM ARCHIVE": "Create Account & Save Library", "VERIFYING IDENTITY…": "Signing In…",
  "Claim Your Archive": "Save Your Library", "⚡ CLAIM NETRUNNER ACCOUNT // SIGN IN": "Create Account / Sign In", "CONNECTED //": "Signed In",
  "Operator name": "Display Name", "operator name": "display name", "Operator Handle": "Username", "Handle": "Username", "handle": "username",
  "night-city-runner": "your-username", "ANONYMOUS NETRUNNER": "Player", "Operator Avatar": "Profile Picture", "Neon accent": "Profile Accent",
  "ICE SECURITY GATEWAY // OPERATOR CREDENTIALS": "Account Settings", "ACCOUNT SECURITY // OPERATOR CREDENTIALS": "Account Security",
  "ICE SECURITY GATEWAY // ACCOUNT RECOVERY": "Account Recovery", "ICE SECURITY GATEWAY // GOOGLE ACCESS": "Google Sign In", "ICE SECURITY GATEWAY // STEAM ACCESS": "Steam Sign In",
  "ICE SECURITY GATEWAY // OPERATOR AUTHENTICATION": "Sign In", "INITIALIZING NETRUNNER ACCESS…": "Loading Sign In…",
  "📌 PIN TO DECK": "Add to Up Next", "📌 PINNED": "In Up Next", "✕ UNPIN": "Remove", "Pin to Up Next Deck": "Add to Up Next",
  "Stage this Backlog gig for later": "Add this game to Up Next", "Upcoming gigs cannot be pinned.": "Unreleased games cannot be added to Up Next.",
  "Deck full (3/3). Unpin a gig to make room.": "Up Next is full (3/3). Remove a game to make room.",
  "⚙ EDIT META": "Edit Game", "▶ START GIG": "Start Playing", "▶ REVIVE GIG": "Resume Playing", "💀 FLATLINE GIG": "Stop Playing",
  "PRIVATE FIELD LOG": "Private Notes", "HYPE LEVEL": "Hype Level", "Flatlined": "Dropped",
  "ANNUAL TELEMETRY // YEAR IN REVIEW": "Year in Review", "Hall of Fame // Pinned Profile Favorites": "Favorite Games",
  "⚙ PERSONALIZE IDENTITY": "Edit Profile", "💾 SAVE IDENTITY TO ARCHIVE": "Save Profile", "UNSAVED IDENTITY CHANGES": "Unsaved Profile Changes",
  "Primary Rig": "Preferred Platform", "⟳ LOG REPLAY / +1 CLEAR": "Log Completed Replay", "LOGGING CLEAR…": "Saving Replay…",
  "🤖 AGENT PLAYTIME AUDIT": "Estimate Playtime", "🤖 AUDITING PLAYTIME…": "Estimating Playtime…", "AGENT // PLAYTIME & GIG BRIEFING": "Playtime Estimate",
  "🗄️ DATA VAULT // IMPORT & EXPORT": "Import & Export",
  "GOOGLE CONNECTION // IDENTITY LINK": "Google Account", "⚠ DANGER ZONE // ARCHIVE TERMINATION": "Delete Account",
  "System telemetry, chronology maintenance, and player account controls.": "Site statistics, game series ordering, and player account settings.",
  "CONNECTING TO SYSTEM TELEMETRY…": "Loading Site Statistics…", "High Taste Match": "Matches Your Taste", "Saga Follow": "Related Games",
  "Claim and save a unique handle first to activate your public dossier link.": "Save a unique username to share your public profile.",
  "PUBLIC DOSSIER LINK COPIED // READY FOR TRANSMISSION": "Profile Link Copied", "IMAGE CLIPBOARD UNAVAILABLE // USE DOWNLOAD ID SNAPSHOT": "Image Copy Unavailable. Download the Profile Card Instead.",
  "ID CARD COPIED TO CLIPBOARD // READY FOR TRANSMISSION": "Profile Card Copied", "ID SNAPSHOT DOWNLOADED // 2000 × 1360 PNG": "Profile Card Downloaded (2000 × 1360 PNG)",
  "CLIPBOARD ACCESS FAILED // TRY DOWNLOAD ID SNAPSHOT": "Could Not Copy. Try Downloading the Profile Card.", "IDENTITY VERIFICATION // CAREER ARCHIVE": "Player Profile",
  "SYNCING PORTRAIT & TROPHY ARTWORK…": "Loading Profile Images…", "SNAPSHOT READY // HIGH-RESOLUTION PNG": "Profile Card Ready",
  "SYNCING PLAYER IDENTITY…": "Loading Profile…", "🔗 COPY PUBLIC DOSSIER LINK": "Copy Profile Link", "📋 COPY DOSSIER TO CLIPBOARD": "Copy Profile Card",
  "💾 DOWNLOAD ID SNAPSHOT": "Download Profile Card", "ENCODING ID SNAPSHOT…": "Creating Profile Card…", "Curated rankings & shelves": "Lists & Rankings",
  "STEAM CONNECTION // VERIFIED IDENTITY": "Steam Account", "STEAM UPLINK // LIBRARY IMPORT": "Import Steam Library", "PLAYER ACTIVITY": "Player Activity",
  "RELEASE INTEREST": "Release Interest", "RECENT": "Recent", "ACHIEVEMENTS": "Achievements", "100% MASTERED ON STEAM": "All Steam Achievements Unlocked",
  "STEAM ACHIEVEMENTS · NOT AVAILABLE YET": "Steam Achievements Not Yet Available", "Scout / Search": "Search Games", "New & Upcoming Radar": "New & Upcoming", "Popular / Trending": "Popular & Trending",
  "Two tactical routes through your saved backlog, guided by your taste and franchise progression. Finish earlier installments before starting their sequels.": "Recommendations from your backlog based on your taste and game series progress. Finish earlier games before starting their sequels.",
  "Your first account inherits this local library, XP, trophies, and dossier. Nothing is moved or deleted.": "Create an account to save your local library, XP, trophies, and profile.",
  "Only the first registration claims the local archive. Later accounts start fresh.": "The first account saves this local library. Later accounts start with an empty library.",
  "MEMBER COUNT TEMPORARILY OFFLINE": "Player Count Unavailable", "SCANNING MEMBER REGISTRY…": "Loading Player Count…",
  "REGISTERED MEMBER": "registered player", "REGISTERED MEMBERS": "registered players",
  "OPERATOR ARCHIVE WIPED // CONNECTION TERMINATED": "Account Deleted. You Have Been Signed Out.",
  "ADMIN // OVERWATCH": "Admin", "03 // PLAYER DIRECTORY": "Player Directory", "ANALYTICS & CRITIC BREAKDOWN": "Library Overview", "02 // CACHE & SESSION MAINTENANCE": "Cache & Session Maintenance",
  "BACKLOG": "Backlog", "PLAYING": "Playing", "COMPLETED": "Completed", "ALL": "All Games", "FLATLINED": "Dropped",
  "LIVE GIG // IN PROGRESS": "Playing", "💀 FLATLINED // SHELVED": "Dropped", "ARCHIVED GIG PROGRESS": "Playtime",
  "ACTIVE GIG PROGRESS": "Playtime", "Shelved Gig // No Game XP": "No XP Earned", "Potential XP Bounty": "Potential XP",
  "🏆 COMPLETE GIG": "Mark Completed", "🏆 GIG CLEARED": "Completed", "⚡ REVIVED FROM FLATLINE": "Resumed & Completed",
  "Status: Playing → Flatlined": "Status: Playing → Stopped Playing", "Status: Flatlined → Playing": "Status: Stopped Playing → Playing",
  "gigs": "games", "gigs cleared": "games completed", "cleared": "completed", "shelved": "in backlog",
};

/** Explicit feature names plus neutral substitutions for dynamic status messages. */
export function standardCopy(source: string, term?: ThemeTermKey): string {
  if (term) return standardTerms[term];
  const slot = source.match(/^SLOT (\d+)$/);
  if (slot) return `Up Next #${Number(slot[1])}`;
  const dropSlot = source.match(/^\[ \+ DROP GIG INTO SLOT (\d+) \]$/);
  if (dropSlot) return `Drag a game to slot ${dropSlot[1]}`;
  return phrases[source] ?? source.replace(/\bNetrunner\b/gi, "Player").replace(/\boperator[’']s\b/gi, "player’s")
    .replace(/\boperator\b/gi, "player").replace(/\bgigs\b/g, "games").replace(/\bgig\b/g, "game")
    .replace(/\bGIGS\b/g, "GAMES").replace(/\bGIG\b/g, "GAME").replace(/field logs/gi, "notes")
    .replace(/^\d+\s*\/\/\s*/, "").replace(/\s*\/\/\s*/g, " · ")
    .replace(/\bCORTEX\b/g, "Recommendations").replace(/\bcontracts\b/gi, "games");
}
