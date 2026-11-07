import { InputError } from "@/lib/action-result";

export type PlayJournalEdits = { startedAt?: Date | null; completedAt?: Date | null };
type Journal = { startedAt?: Date | null; completedAt?: Date | null };

/** Calendar dates stay stable across browser, server, Prisma and backup time zones. */
export function parseJournalDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError("Play journal dates must use YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < "0001-01-01") throw new InputError("Choose a valid play journal date.");
  return date;
}

export function journalDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

export function validateJournalDates({ startedAt, completedAt }: Journal) {
  if (startedAt && completedAt && completedAt.getTime() < startedAt.getTime()) {
    throw new InputError("Completion date cannot be earlier than the start date. Edit the journal dates or clear the completion date for a new run.");
  }
}

/** Unchanged date inputs are not overrides: a normal Start/Complete still stamps. */
export function readPlayJournalFields(data: FormData): PlayJournalEdits {
  const edits: PlayJournalEdits = {};
  for (const field of ["startedAt", "completedAt"] as const) {
    if (!data.has(field)) continue;
    const value = data.get(field);
    const date = parseJournalDate(value);
    if (!data.has(`${field}Original`) || value !== data.get(`${field}Original`)) edits[field] = date;
  }
  validateJournalDates(edits);
  return edits;
}

/** Used only by explicit player mutations, never bulk imports or Steam sync. */
export function resolvePlayJournal(before: Journal & { status?: string }, status: string, edits: PlayJournalEdits = {}, now = new Date()) {
  const journal = { startedAt: before.startedAt ?? null, completedAt: before.completedAt ?? null, ...edits };
  const today = parseJournalDate(journalDateInput(now))!;
  if (status !== before.status) {
    if (status === "Playing" && !journal.startedAt && !Object.hasOwn(edits, "startedAt")) journal.startedAt = today;
    if (status === "Completed" && !journal.completedAt && !Object.hasOwn(edits, "completedAt")) journal.completedAt = today;
  }
  validateJournalDates(journal);
  return journal;
}

/** Backups accept our date-only format and older ISO timestamp exports, never loose Date.parse inputs. */
export function importJournalDate(value: unknown): Date | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new InputError("Choose a valid play journal date.");
    return parseJournalDate(journalDateInput(value));
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    parseJournalDate(value.slice(0, 10));
    if (!Number.isFinite(Date.parse(value)) || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d/.test(value.slice(11))) throw new InputError("Choose a valid play journal timestamp.");
    return parseJournalDate(value.slice(0, 10));
  }
  return parseJournalDate(value);
}

export function journalDateLabel(value: string | null | undefined): string | null {
  const date = journalDateInput(value);
  return date ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
}

type SortableJournal = { id: number; completedAt?: string | null; createdAt: string };
/** Unknown completion dates use library-added dates; ties remain stable. */
export function compareCompletionDates(a: SortableJournal, b: SortableJournal, direction: "asc" | "desc" = "desc") {
  const time = (game: SortableJournal) => {
    const completed = Date.parse(game.completedAt || "");
    return Number.isFinite(completed) ? completed : Date.parse(game.createdAt) || 0;
  };
  return (direction === "asc" ? time(a) - time(b) : time(b) - time(a)) || a.id - b.id;
}
