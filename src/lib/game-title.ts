// Keep ownership checks consistent across punctuation, case, accents, and sequel numerals.
export function normalizeGameTitle(title: string) {
  const numerals: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  return title.replace(/[™®]/g, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[\[(](?:19|20)\d{2}[\])]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\b(?:viii|vii|iii|vi|iv|ix|ii|i|v|x)\b/g, (value) => numerals[value])
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
