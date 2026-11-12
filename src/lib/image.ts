// Shrink a phone photo before it is read: long edge at most 1568 px (what
// Claude reads images at), JPEG. All pages together must fit the HintWise
// gateway's 1,000,000-byte request, base64 included, with room for the
// prompt and the answer schema.

export interface PreparedImage {
  mediaType: "image/jpeg";
  data: string; // base64, no data: prefix
  previewUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export const MAX_EDGE = 1568;
/** Base64 bytes for all photos in one request. */
export const PHOTO_BUDGET = 900_000;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the photo."))), "image/jpeg", quality),
  );
}

async function draw(source: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch {
    const name = source instanceof File ? `"${source.name}"` : "this photo";
    throw new Error(
      `Your browser cannot open ${name}. Try a JPEG or PNG (on iPhone, Settings > Camera > Formats > Most Compatible).`,
    );
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the photo.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

async function encode(canvas: HTMLCanvasElement, maxBase64: number): Promise<{ blob: Blob; data: string }> {
  let last: { blob: Blob; data: string } | null = null;
  for (const q of QUALITIES) {
    const blob = await toBlob(canvas, q);
    last = { blob, data: await blobToBase64(blob) };
    if (last.data.length <= maxBase64) return last;
  }
  return last!;
}

function prepared(canvas: HTMLCanvasElement, enc: { blob: Blob; data: string }): PreparedImage {
  return {
    mediaType: "image/jpeg",
    data: enc.data,
    previewUrl: URL.createObjectURL(enc.blob),
    width: canvas.width,
    height: canvas.height,
    bytes: enc.blob.size,
  };
}

export async function prepareImage(file: File, maxBase64 = PHOTO_BUDGET): Promise<PreparedImage> {
  const canvas = await draw(file);
  return prepared(canvas, await encode(canvas, maxBase64));
}

/** Pages together within the budget: re-encode the larger ones if needed. */
export async function fitPhotos(pages: PreparedImage[], budget = PHOTO_BUDGET): Promise<PreparedImage[]> {
  const total = pages.reduce((n, p) => n + p.data.length, 0);
  if (total <= budget) return pages;
  const each = Math.floor(budget / pages.length);
  return Promise.all(
    pages.map(async (p) => {
      if (p.data.length <= each) return p;
      const canvas = await draw(await (await fetch(p.previewUrl)).blob());
      return prepared(canvas, await encode(canvas, each));
    }),
  );
}
