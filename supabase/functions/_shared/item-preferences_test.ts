import { assertEquals } from "jsr:@std/assert@1";
import { normalizeItemPreference } from "./item-preferences.ts";
Deno.test("preferência ausente usa substituir por similar", () => assertEquals(normalizeItemPreference(undefined, undefined), { item_note: "", substitution_preference: "replace" }));
Deno.test("aceita somente as duas opções novas", () => { for (const choice of ["replace", "remove"]) if (!normalizeItemPreference("Maduro", choice)) throw new Error("preferência rejeitada: " + choice); });
Deno.test("converte preferência legada me chamar para substituir por similar", () => assertEquals(normalizeItemPreference("Maduro", "call"), { item_note: "Maduro", substitution_preference: "replace" }));
Deno.test("remove tags HTML e caracteres de controle", () => assertEquals(normalizeItemPreference("<b>Maduro</b>\u0000 & verde", "replace"), { item_note: "Maduro  & verde", substitution_preference: "call" }));
Deno.test("rejeita observação acima de 100 caracteres", () => assertEquals(normalizeItemPreference("x".repeat(101), "call"), null));
Deno.test("rejeita tipo de substituição desconhecido", () => assertEquals(normalizeItemPreference("Maduro", "other"), null));
Deno.test("preserva observação de compra por kg, valor ou unidade sem alterar quantidades/preços", () => assertEquals(normalizeItemPreference("1,25 kg maduro", "remove"), { item_note: "1,25 kg maduro", substitution_preference: "remove" }));

Deno.test("preferências não acrescentam campos de preço ou quantidade para kg, valor e unidade", () => {
  for (const saleMode of ["kg", "value", "unit"]) {
    const result = normalizeItemPreference("Maduro & fresco", "replace");
    assertEquals(Object.keys(result || {}).sort(), ["item_note", "substitution_preference"]);
    assertEquals(result?.item_note, "Maduro & fresco");
  }
});
