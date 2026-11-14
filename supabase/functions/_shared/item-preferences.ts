export type ItemSubstitutionPreference = "replace" | "remove" | "call";
export type NormalizedItemPreference = { item_note: string; substitution_preference: ItemSubstitutionPreference };

export function normalizeItemPreference(note: unknown, substitution: unknown): NormalizedItemPreference | null {
  if (note !== undefined && (typeof note !== "string" || note.length > 100)) return null;
  const choice = substitution ?? "call";
  if (choice !== "replace" && choice !== "remove" && choice !== "call") return null;
  const clean = String(note ?? "")
    .replace(/[\\u0000-\\u001F\\u007F]/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 100);
  return { item_note: clean, substitution_preference: choice };
}
