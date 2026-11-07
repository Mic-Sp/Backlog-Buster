"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/lib/action-result";
import { createList, updateList, deleteList, changeListItems } from "@/lib/custom-lists";

function refreshLists() {
  revalidatePath("/");
  revalidatePath("/dossier/[handle]", "page");
}
export async function createCustomList(input: unknown) {
  return safeAction(async () => { const result = await createList(input); refreshLists(); return result; });
}
export async function updateCustomList(id: unknown, input: unknown) {
  return safeAction(async () => { await updateList(id, input); refreshLists(); });
}
export async function deleteCustomList(id: unknown) {
  return safeAction(async () => { await deleteList(id); refreshLists(); });
}
export async function updateCustomListItems(id: unknown, input: unknown) {
  return safeAction(async () => { await changeListItems(id, input); refreshLists(); });
}
