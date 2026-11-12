export function validatePhoto(image, multipleImages = false) {
  if (multipleImages || Array.isArray(image)) return { ok: false, error: "Envie apenas uma foto." };
  if (!image || typeof image !== "object" || image.media_type !== "image/jpeg") {
    return { ok: false, error: "A foto deve estar no formato JPEG." };
  }
  if (typeof image.data !== "string" || !image.data || image.data.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)) {
    return { ok: false, error: "A foto enviada é inválida." };
  }
  let binary;
  try { binary = atob(image.data); } catch { return { ok: false, error: "A foto enviada é inválida." }; }
  if (binary.length > 450 * 1024) return { ok: false, error: "A foto deve ter no máximo 450 KB." };
  if (binary.length < 4 || binary.charCodeAt(0) !== 0xff || binary.charCodeAt(1) !== 0xd8 || binary.charCodeAt(2) !== 0xff ||
      binary.charCodeAt(binary.length - 2) !== 0xff || binary.charCodeAt(binary.length - 1) !== 0xd9) {
    return { ok: false, error: "O arquivo enviado não é uma imagem JPEG válida." };
  }
  return { ok: true, data: image.data };
}

export function reconcilePhotoLines(output, catalog, allowedIds = new Set(catalog.map((product) => product.id)), compactCatalogMode = false) {
  const itens = [];
  const perguntas = [];
  const rawLines = Array.isArray(output?.linhas) ? output.linhas : [];
  const total = output?.total_linhas;
  if (total === 0 && rawLines.length === 0) {
    return { itens, perguntas: ["Não consegui identificar lista nem produto nessa foto. Tente outra foto mais nítida."] };
  }
  const lines = rawLines.slice(0, 30);
  const indexes = new Set(lines.map((line) => line?.numero));
  const exceededLimit = rawLines.length > 30 || (Number.isInteger(total) && total > 30);
  const expectedValid = !exceededLimit && Number.isInteger(total) && total >= 1 && total <= 30 &&
    lines.length === total && Array.from({ length: total }, (_, i) => i + 1).every((n) => indexes.has(n));
  if (!expectedValid) perguntas.push("Confira a foto: pode haver linhas faltando ou mais de 30 itens. Revise a lista antes de adicionar.");
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const promptIds = allowedIds;
  const byProduct = new Map();
  for (const line of lines) {
    const label = String(line?.texto || line?.produto || `linha ${line?.numero || "não identificada"}`).trim().slice(0, 100);
    if (line?.status === "ambiguo" || line?.status === "ilegivel") {
      const suppliedQuestion = typeof line?.pergunta === "string"
        ? line.pergunta.replace(/[\r\n]+/g, " ").trim().slice(0, 160)
        : "";
      perguntas.push(suppliedQuestion || `Não consegui identificar com segurança: ${label}. Pode confirmar o produto e a quantidade?`);
      continue;
    }
    if (line?.status === "nao_encontrado") {
      perguntas.push(`nao_encontrado: ${label}`);
      continue;
    }
    if (line?.status !== "ok") {
      perguntas.push(`Confira esta linha da foto: ${label}.`);
      continue;
    }
    const id = typeof line.product_id === "string" ? line.product_id : "";
    if (!id || !promptIds.has(id) || !byId.has(id)) {
      perguntas.push(`nao_encontrado: ${label}`);
      continue;
    }
    const product = byId.get(id);
    const quantity = line.quantidade;
    const step = product.passo ?? 1;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) ||
        quantity < product.minimo || quantity > Math.min(100, product.maximo) ||
        !Number.isInteger(quantity / step) ||
        (compactCatalogMode && !Number.isInteger(quantity))) {
      perguntas.push(`Confira a quantidade de ${label}; não incluí esta linha.`);
      continue;
    }
    const combined = (byProduct.get(id) || 0) + quantity;
    if (combined > Math.min(100, product.maximo) || !Number.isInteger(combined / step) ||
        (compactCatalogMode && !Number.isInteger(combined))) {
      perguntas.push(`Confira a quantidade total de ${label}; não incluí esta linha.`);
      continue;
    }
    byProduct.set(id, combined);
  }
  for (const [product_id, quantidade] of byProduct) itens.push({ product_id, quantidade });
  if (!itens.length && !perguntas.length) perguntas.push("Não consegui confirmar itens na foto. Confira a lista e envie novamente se necessário.");
  return { itens, perguntas };
}
