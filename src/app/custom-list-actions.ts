"use server";
import { safeAction } from "@/lib/action-result";
import { mutateCustomList } from "@/lib/custom-lists";
import { revalidatePath } from "next/cache";

export async function changeCustomList(input: unknown) {
  return safeAction(async () => {
    const result = await mutateCustomList(input);
    revalidatePath("/");
    revalidatePath("/dossier/[handle]", "page");
    return result;
  });
}
