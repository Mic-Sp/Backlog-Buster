# Backlog Buster

A gamified video game backlog tracker. Track games across status stages (*Backlog*, *Playing*, *Completed*), earn XP based on game length and difficulty, level up, and automatically pull game metadata and box art using the RAWG API.

## Tech Stack

- **Framework:** Next.js (App Router, Server Actions)
- **Language & Styling:** TypeScript, Tailwind CSS
- **Database & ORM:** PostgreSQL (Neon Serverless), Prisma ORM
- **Integrations:** [RAWG Video Games Database API](https://rawg.io/apidocs)

## Prerequisites

- Node.js 20+
- A PostgreSQL database (e.g. [Neon](https://neon.tech))
- A RAWG API key (optional, for automatic game metadata lookup)

## Getting Started

### 1. Clone & Install Dependencies

```bash
git clone <repository-url>
cd backlogbuster
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB_NAME?sslmode=require"
RAWG_API_KEY="your_rawg_api_key" # optional
```

### 3. Sync Database Schema

Push the Prisma schema to your PostgreSQL database:

```bash
npx prisma db push
npx prisma generate
```

### One-time admin bootstrap

After syncing the schema, use Node.js 22.18+ to run
`ADMIN_BOOTSTRAP_PLAYER_ID="existing-player-id" npm run admin:bootstrap`.
The optional identifier can also be supplied through `.env`; it must identify an
existing account with email/password credentials. The command accepts no email or
handle fallback and never runs during login or profile changes.

Bootstrap uses a transaction and a database lock. It promotes the selected account
only when there are no admins and no completion marker. An existing admin seals
bootstrap without promoting anyone. The permanent `AdminBootstrap` marker remains
after demotion or deletion, preventing subsequent reactivation. Future admin access
depends solely on `Player.isAdmin` and an active authenticated session, checked by
the server-only `requireAdmin()` helper. Client `isAdmin` props are for display only.

For an existing database created before Player profiles, run the additive backfill
before `db push` so every game and achievement owner has a Player record:

```bash
npx prisma db execute --file prisma/backfill-player-profiles.sql
npx prisma db push
npx prisma generate
```

The backfill preserves the existing `userId` columns, links them to `Player.id`,
and checks every game and achievement row before committing. It is safe to rerun.
Restart the development server after generating the updated Prisma Client.

Dossier identity settings autosave to the current Player profile in PostgreSQL.
Featured trophies must belong to that player and be completed five-star games.

### Accounts and Sessions

Use **CLAIM NETRUNNER ACCOUNT // SIGN IN** in the player HUD to register or log in.
The first registration upgrades the unclaimed `default-player` row in place,
preserving its games, achievements, XP, and profile. Later registrations create
independent empty libraries. Anonymous access is available only while the local
profile has no credentials; after claiming it, logging out shows the sign-in screen.

- Passwords use Node's salted `scrypt` (`N=131072`, `r=8`, `p=1`), following the
  [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
  Registration and login accept 8–128 characters; passwords are never trimmed or stored as plaintext.
- Sessions last seven days and use HMAC-signed, HTTP-only, SameSite=Lax cookies.
  Only the session token hash is stored in `PlayerSession`. Logging out revokes the
  database session, preventing replay. Production cookies use `Secure` and the
  `__Host-` prefix, so production must be served over HTTPS.
- Without an externally supplied `AUTH_SECRET`, a cryptographically random signing
  key is generated once in the server-only `AuthSecret` table and shared by app
  instances. No additional environment configuration is required. An optional
  `AUTH_SECRET` must contain at least 32 bytes and be consistent across instances;
  changing it invalidates existing cookies.
- Email and handles are normalized to lowercase. Signup claims and duplicate
  checks are serialized in a database transaction. Persistent throttles allow ten
  attempts per email per fifteen minutes and sixty attempts globally per minute.
- `getCurrentPlayer()` and `getCurrentPlayerId()` resolve ownership on the server
  from the active session. Game actions, dossier saves, recommendations, and
  achievement calculations never accept a browser-supplied owner ID. Browser
  achievement/level notification history is scoped to each account.

### 4. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to view the application.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Starts the development server |
| `npm run build` | Builds the production bundle |
| `npm run start` | Runs the production build |
| `npm run lint` | Runs ESLint |
| `npm run test:auth` | Runs isolated authentication and archive-claim regression tests (no database required) |
