"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/lib/action-result";
import { changeFriendship, discoverPlayers, setProfileVisibility } from "@/lib/friendships";

function refreshProfiles() {
  revalidatePath("/dossier/[handle]", "page");
  revalidatePath("/");
}

export async function searchPlayers(query: unknown) {
  return safeAction(async () => ({ players: await discoverPlayers(query) }));
}

export async function sendFriendRequest(playerId: unknown) {
  return safeAction(async () => { const result = await changeFriendship(playerId, "send"); refreshProfiles(); return result; });
}
export async function acceptFriendRequest(playerId: unknown) {
  return safeAction(async () => { const result = await changeFriendship(playerId, "accept"); refreshProfiles(); return result; });
}
export async function declineFriendRequest(playerId: unknown) {
  return safeAction(async () => { const result = await changeFriendship(playerId, "decline"); refreshProfiles(); return result; });
}
export async function cancelFriendRequest(playerId: unknown) {
  return safeAction(async () => { const result = await changeFriendship(playerId, "cancel"); refreshProfiles(); return result; });
}
export async function removeFriend(playerId: unknown) {
  return safeAction(async () => { const result = await changeFriendship(playerId, "remove"); refreshProfiles(); return result; });
}
export async function blockPlayer(playerId: unknown) {
  return safeAction(async () => { const result = await changeFriendship(playerId, "block"); refreshProfiles(); return result; });
}
export async function unblockPlayer(playerId: unknown) {
  return safeAction(async () => { const result = await changeFriendship(playerId, "unblock"); refreshProfiles(); return result; });
}
export async function updateProfileVisibility(visibility: unknown) {
  return safeAction(async () => { const result = await setProfileVisibility(visibility); refreshProfiles(); return result; });
}
