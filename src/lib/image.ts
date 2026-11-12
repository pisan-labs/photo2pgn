// Shrink a phone photo before it is read: long edge at most 1568 px (what
// Claude reads images at), JPEG. All pages together must fit the HintWise
// gateway's 1,000,000-byte request, base64 included, with room for the
// prompt and the answer schema.

export type Rotation = 0 | 90 | 180 | 270;
/** A crop as fractions of the rotated photo: 0..1. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

export interface PreparedImage {
  mediaType: "image/jpeg";
  data: string; // base64, no data: prefix
  previewUrl: string;
  width: number;
  height: number;
  bytes: number;
  source: Blob; // the original photo, kept in memory for rotating and cropping
  rotation: Rotation;
  crop: Crop;
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

async function draw(source: Blob, rotation: Rotation = 0, crop: Crop = FULL): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch {
    const name = source instanceof File ? `"${source.name}"` : "this photo";
    throw new Error(
      `Your browser cannot open ${name}. Try a JPEG or PNG (on iPhone, Settings > Camera > Formats > Most Compatible).`,
    );
  }
  // The rotated photo's size, and the crop within it, in source pixels.
  const turned = rotation === 90 || rotation === 270;
  const rw = turned ? bitmap.height : bitmap.width;
  const rh = turned ? bitmap.width : bitmap.height;
  const cw = Math.max(1, Math.round(crop.w * rw));
  const ch = Math.max(1, Math.round(crop.h * rh));
  const scale = Math.min(1, MAX_EDGE / Math.max(cw, ch));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the photo.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Map the crop window onto the canvas, then draw the rotated photo through it.
  ctx.scale(scale, scale);
  ctx.translate(-crop.x * rw, -crop.y * rh);
  ctx.translate(rw / 2, rh / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
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

function prepared(
  canvas: HTMLCanvasElement,
  enc: { blob: Blob; data: string },
  source: Blob,
  rotation: Rotation,
  crop: Crop,
): PreparedImage {
  return {
    mediaType: "image/jpeg",
    data: enc.data,
    previewUrl: URL.createObjectURL(enc.blob),
    width: canvas.width,
    height: canvas.height,
    bytes: enc.blob.size,
    source,
    rotation,
    crop,
  };
}

export async function prepareImage(file: Blob, maxBase64 = PHOTO_BUDGET): Promise<PreparedImage> {
  const canvas = await draw(file);
  return prepared(canvas, await encode(canvas, maxBase64), file, 0, FULL);
}

/** Rotate and crop, from the original photo, so a crop keeps its detail. */
export async function editImage(p: PreparedImage, rotation: Rotation, crop: Crop, maxBase64 = PHOTO_BUDGET): Promise<PreparedImage> {
  const canvas = await draw(p.source, rotation, crop);
  URL.revokeObjectURL(p.previewUrl);
  return prepared(canvas, await encode(canvas, maxBase64), p.source, rotation, crop);
}

/** Pages together within the budget: re-encode the larger ones if needed. */
export async function fitPhotos(pages: PreparedImage[], budget = PHOTO_BUDGET): Promise<PreparedImage[]> {
  const total = pages.reduce((n, p) => n + p.data.length, 0);
  if (total <= budget) return pages;
  const each = Math.floor(budget / pages.length);
  return Promise.all(
    pages.map(async (p) => {
      if (p.data.length <= each) return p;
      const canvas = await draw(p.source, p.rotation, p.crop);
      return prepared(canvas, await encode(canvas, each), p.source, p.rotation, p.crop);
    }),
  );
}

/** The whole photo turned by `rotation`, for the crop editor. */
export async function rotatedPreview(source: Blob, rotation: Rotation): Promise<string> {
  const canvas = await draw(source, rotation, FULL);
  return URL.createObjectURL(await toBlob(canvas, 0.8));
}
