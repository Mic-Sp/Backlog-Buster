import type { IncomingFriendRequest } from "@/lib/social-types";

export const FRIENDSHIP_CHANGE_EVENT = "backlogbuster:friendships-changed";
export const FRIEND_REQUEST_SEEN_PREFIX = "backlogbuster:friend-requests:seen:";
const MAX_SEEN = 500;
type SeenStorage = Pick<Storage, "getItem" | "setItem">;
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;

export function readSeenFriendRequests(storage: SeenStorage, viewerId: string): string[] {
  try {
    const raw = storage.getItem(`${FRIEND_REQUEST_SEEN_PREFIX}${viewerId}`);
    if (!raw || raw.length > 150_000) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? [...new Set(value.filter(validId))].slice(-MAX_SEEN) : [];
  } catch { return []; }
}

export function markFriendRequestsSeen(storage: SeenStorage, viewerId: string, memory: string[], ids: string[]): string[] {
  const known = new Set([...readSeenFriendRequests(storage, viewerId), ...memory].filter(validId));
  // Keep the requests being dismissed now even when an older tab holds a full history.
  for (const id of ids.filter(validId)) { known.delete(id); known.add(id); }
  const seen = [...known].slice(-MAX_SEEN);
  try { storage.setItem(`${FRIEND_REQUEST_SEEN_PREFIX}${viewerId}`, JSON.stringify(seen)); }
  catch { /* Dismissal still works in memory when storage is unavailable. */ }
  return seen;
}

export function unseenFriendRequests(requests: IncomingFriendRequest[], seen: string[]): IncomingFriendRequest[] {
  const known = new Set(seen);
  return requests.filter(request => !known.has(request.id));
}
