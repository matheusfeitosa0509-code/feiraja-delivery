import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePhoto, reconcilePhotoLines } from './photo.js';

const jpeg = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";
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
