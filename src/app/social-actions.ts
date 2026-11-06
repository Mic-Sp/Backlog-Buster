"use server";
import { safeAction } from "@/lib/action-result";
import { getSocialOverview, getCoopMatches } from "@/lib/social";
import { getIncomingFriendRequests } from "@/lib/incoming-friend-requests";

export async function fetchSocialOverview() { return safeAction(getSocialOverview); }
export async function fetchCoopMatches(input: unknown) { return safeAction(() => getCoopMatches(input)); }
export async function fetchIncomingFriendRequests() { return safeAction(getIncomingFriendRequests); }
