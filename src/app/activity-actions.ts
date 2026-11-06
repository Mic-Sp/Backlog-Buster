"use server";

import { safeAction } from "@/lib/action-result";
import { getFriendActivityFeed } from "@/lib/activity-feed";

export async function fetchFriendActivity(input: unknown = {}) {
  return safeAction(() => getFriendActivityFeed(input));
}
