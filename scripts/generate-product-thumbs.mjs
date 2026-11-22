import sharp from 'sharp';

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const dryRun = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const bucket = 'product-photos';
const pageSize = 100;

if (!supabaseUrl || !serviceKey) {
  throw new Error('Configure os secrets SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no GitHub Actions.');
}

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
async function listPage(prefix, offset) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!response.ok) throw new Error(`Falha ao listar ${prefix || '/'}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
}
async function walk(prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += pageSize) {
    const rows = await listPage(prefix, offset);
    for (const row of rows) {
      const path = prefix ? `${prefix}/${row.name}` : row.name;
      if (!row.id && !row.metadata) {
        files.push(...await walk(path));
      } else {
        files.push({ path, metadata: row.metadata || {} });
      }
    }
    if (rows.length < pageSize) break;
  }
  return files;
}
async function download(path) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodePath(path)}`, { headers });
  if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function upload(path, bytes) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodePath(path)}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'image/webp', 'x-upsert': 'false' },
    body: bytes,
  });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(`Upload HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`);
  return true;
}

const objects = await walk();
const names = new Set(objects.map(item => item.path));
const originals = objects.filter(item => /\.(?:jpe?g|png|webp|avif)$/i.test(item.path) && !/_320\.webp$/i.test(item.path));
const pending = originals.filter(item => {
  const thumb = item.path.replace(/\.(jpe?g|png|webp|avif)$/i, '_320.webp');
  return !names.has(thumb);
});
console.log(`Bucket ${bucket}: ${objects.length} objetos; ${originals.length} imagens; ${pending.length} miniaturas ausentes; dry_run=${dryRun}`);

let processed = 0;
let errors = 0;
for (const item of pending) {
  const thumbPath = item.path.replace(/\.(jpe?g|png|webp|avif)$/i, '_320.webp');
  try {
    if (dryRun) {
      console.log(`DRY RUN ${item.path} -> ${thumbPath}`);
      processed++;
      continue;
    }
    const source = await download(item.path);
    const webp = await sharp(source).rotate().resize({ width: 320, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
    if (await upload(thumbPath, webp)) {
      console.log(`OK ${item.path} -> ${thumbPath} (${source.length} -> ${webp.length} bytes)`);
      processed++;
    } else {
      console.log(`SKIP existente ${thumbPath}`);
    }
  } catch (error) {
    errors++;
    console.error(`ERRO ${item.path}: ${error?.message || error}`);
  }
}
console.log(`RESUMO total_listado=${objects.length} imagens=${originals.length} miniaturas_pendentes=${pending.length} processadas=${processed} erros=${errors} dry_run=${dryRun}`);
if (errors) process.exitCode = 1;
