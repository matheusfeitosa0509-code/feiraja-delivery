import test from "node:test";
import assert from "node:assert/strict";
import { validatePhoto, reconcilePhotoLines } from "./photo.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64");
const catalog = [{ id: "p1", nome: "Maçã", unidade: "kg", passo: 0.5, minimo: 0.5, maximo: 100 }];

test("JPEG válido é aceito", () => assert.equal(validatePhoto({ media_type: "image/jpeg", data: jpeg }).ok, true));
test("assinatura errada é rejeitada", () => assert.equal(validatePhoto({ media_type: "image/jpeg", data: Buffer.from("not jpeg").toString("base64") }).ok, false));
test("base64 inválido é rejeitado", () => assert.equal(validatePhoto({ media_type: "image/jpeg", data: "%%%=" }).ok, false));
test("imagem acima de 450 KiB é rejeitada", () => {
  const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(450 * 1024)]).toString("base64");
  assert.equal(validatePhoto({ media_type: "image/jpeg", data: oversized }).ok, false);
});
test("media_type diferente é rejeitado", () => assert.equal(validatePhoto({ media_type: "image/png", data: jpeg }).ok, false));
test("mais de uma imagem é rejeitada", () => assert.equal(validatePhoto({ media_type: "image/jpeg", data: jpeg }, true).ok, false));
test("linha ok válida vira item", () => {
  const result = reconcilePhotoLines({ total_linhas: 1, linhas: [{ numero: 1, status: "ok", texto: "maçã", product_id: "p1", quantidade: 1, unidade: "kg" }] }, catalog);
  assert.deepEqual(result.itens, [{ product_id: "p1", quantidade: 1 }]);
});
test("linha ok com ID fora do catálogo vira nao_encontrado", () => {
  const result = reconcilePhotoLines({ total_linhas: 1, linhas: [{ numero: 1, status: "ok", texto: "pera", product_id: "fora", quantidade: 1, unidade: "kg" }] }, catalog);
  assert.match(result.perguntas.join(" "), /nao_encontrado: pera/);
});
test("linhas ambígua e ilegível viram perguntas", () => {
  const result = reconcilePhotoLines({ total_linhas: 2, linhas: [{ numero: 1, status: "ambiguo", texto: "maçã ou pera" }, { numero: 2, status: "ilegivel", texto: "linha apagada" }] }, catalog);
  assert.equal(result.perguntas.length, 2);
});
test("linha faltando pede conferência", () => {
  const result = reconcilePhotoLines({ total_linhas: 2, linhas: [{ numero: 1, status: "ok", texto: "maçã", product_id: "p1", quantidade: 1, unidade: "kg" }] }, catalog);
  assert.match(result.perguntas.join(" "), /linhas faltando/);
});
