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
```

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
