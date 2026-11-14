import { assertEquals } from "jsr:@std/assert@1";
import { normalizeItemPreference } from "./item-preferences.ts";
Deno.test("preferência ausente usa padrão me chamar", () => assertEquals(normalizeItemPreference(undefined, undefined), { item_note: "", substitution_preference: "call" }));
Deno.test("aceita os três tipos de substituição", () => { for (const choice of ["replace", "remove", "call"]) if (!normalizeItemPreference("Maduro", choice)) throw new Error("preferência rejeitada: " + choice); });
Deno.test("remove tags HTML e caracteres de controle", () => assertEquals(normalizeItemPreference("<b>Maduro</b>\u0000 & verde", "call"), { item_note: "Maduro  & verde", substitution_preference: "call" }));
Deno.test("rejeita observação acima de 100 caracteres", () => assertEquals(normalizeItemPreference("x".repeat(101), "call"), null));
Deno.test("rejeita tipo de substituição desconhecido", () => assertEquals(normalizeItemPreference("Maduro", "other"), null));
Deno.test("preserva observação de compra por kg, valor ou unidade sem alterar quantidades/preços", () => assertEquals(normalizeItemPreference("1,25 kg maduro", "remove"), { item_note: "1,25 kg maduro", substitution_preference: "remove" }));
