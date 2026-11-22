import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const input = path.resolve('imagens/produtos');
const output = path.resolve(process.env.STOREFRONT_WEBP_OUTPUT || '_site/imagens/produtos');
const allowed = new Set(['.jpg', '.jpeg', '.png']);
let converted = 0;
let originalBytes = 0;
let webpBytes = 0;

async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const source = path.join(dir, entry.name);
    if (entry.isDirectory()) { await walk(source); continue; }
    const ext = path.extname(entry.name).toLowerCase();
    if (!allowed.has(ext)) continue;
    const target = path.join(output, path.relative(input, source)).replace(/\.(?:jpe?g|png)$/i, '.webp');
    await fs.mkdir(path.dirname(target), { recursive: true });
    const result = await sharp(source, { failOn: 'none' })
      .rotate()
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 75, effort: 5 })
      .toFile(target);
    const stat = await fs.stat(source);
    originalBytes += stat.size;
    webpBytes += result.size;
    converted++;
  }
}
await walk(input);
console.log(JSON.stringify({ converted, originalBytes, webpBytes, savedBytes: originalBytes - webpBytes }));
