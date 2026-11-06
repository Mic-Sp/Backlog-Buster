"use server";
import { safeAction } from "@/lib/action-result";
import { getSocialOverview, getCoopMatches } from "@/lib/social";

export async function fetchSocialOverview() { return safeAction(getSocialOverview); }
export async function fetchCoopMatches(input: unknown) { return safeAction(() => getCoopMatches(input)); }
