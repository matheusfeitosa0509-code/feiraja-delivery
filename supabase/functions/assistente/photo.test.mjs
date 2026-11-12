import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePhoto, reconcilePhotoLines } from './photo.js';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64), Buffer.from([0xff, 0xd9])]).toString('base64');
const catalog = [{ id: 'p1', nome: 'Maçã', unidade: 'kg', passo: 0.5, minimo: 0.5, maximo: 100 }];

test('JPEG válido é aceito', () => assert.equal(validatePhoto({ media_type: 'image/jpeg', data: jpeg }).ok, true));
test('assinatura errada é rejeitada', () => assert.equal(validatePhoto({ media_type: 'image/jpeg', data: Buffer.from('not jpeg').toString('base64') }).ok, false));
test('base64 inválido é rejeitado', () => assert.equal(validatePhoto({ media_type: 'image/jpeg', data: '%%%=' }).ok, false));
test('imagem acima de 450 KiB é rejeitada', () => {
  const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(450 * 1024), Buffer.from([0xff, 0xd9])]).toString('base64');
  assert.equal(validatePhoto({ media_type: 'image/jpeg', data: oversized }).ok, false);
});
test('media_type diferente é rejeitado', () => assert.equal(validatePhoto({ media_type: 'image/png', data: jpeg }).ok, false));
test('mais de uma imagem é rejeitada', () => assert.equal(validatePhoto({ media_type: 'image/jpeg', data: jpeg }, true).ok, false));
test('linha ok válida vira item', () => {
  const result = reconcilePhotoLines({ total_linhas: 1, linhas: [{ numero: 1, status: 'ok', texto: 'maçã', product_id: 'p1', quantidade: 1, unidade: 'kg' }] }, catalog);
  assert.deepEqual(result.itens, [{ product_id: 'p1', quantidade: 1 }]);
});
test('pergunta por linha é usada e sanitizada', () => {
  const result = reconcilePhotoLines({ total_linhas: 1, linhas: [{ numero: 1, status: 'ambiguo', texto: 'maçã', pergunta: 'É Maçã ou Pera?\nConfirme.' }] }, catalog);
  assert.deepEqual(result.perguntas, ['É Maçã ou Pera? Confirme.']);
});
test('total_linhas zero retorna pergunta específica sem conferência', () => {
  const result = reconcilePhotoLines({ total_linhas: 0, linhas: [] }, catalog);
  assert.deepEqual(result, { itens: [], perguntas: ['Não consegui identificar lista nem produto nessa foto. Tente outra foto mais nítida.'] });
});
test('modo compacto aceita item inteiro sem unidade no catálogo', () => {
  const compactCatalog = [{ id: 'p1', nome: 'Maçã', passo: 0.5, minimo: 1, maximo: 100 }];
  const result = reconcilePhotoLines({ total_linhas: 1, linhas: [{ numero: 1, status: 'ok', texto: 'maçã', product_id: 'p1', quantidade: 2, unidade: null }] }, compactCatalog, new Set(['p1']), true);
  assert.deepEqual(result.itens, [{ product_id: 'p1', quantidade: 2 }]);
});
test('linha ok com ID fora do catálogo vira nao_encontrado', () => {
  const result = reconcilePhotoLines({ total_linhas: 1, linhas: [{ numero: 1, status: 'ok', texto: 'pera', product_id: 'fora', quantidade: 1, unidade: 'kg' }] }, catalog);
  assert.match(result.perguntas.join(' '), /nao_encontrado: pera/);
});
test('linhas ambígua e ilegível viram perguntas', () => {
  const result = reconcilePhotoLines({ total_linhas: 2, linhas: [{ numero: 1, status: 'ambiguo', texto: 'maçã ou pera' }, { numero: 2, status: 'ilegivel', texto: 'linha apagada' }] }, catalog);
  assert.equal(result.perguntas.length, 2);
});
test('linha faltando continua pedindo conferência', () => {
  const result = reconcilePhotoLines({ total_linhas: 2, linhas: [{ numero: 1, status: 'ok', texto: 'maçã', product_id: 'p1', quantidade: 1, unidade: 'kg' }] }, catalog);
  assert.match(result.perguntas.join(' '), /linhas faltando/);
});
