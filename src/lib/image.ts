// Shrink a phone photo before upload: long edge at most 2400 px, JPEG.
// Claude reads handwriting well at this size. Two pages of at most 1.9 MB
// each stay under the 6 MB request limit of a Netlify function once
// base64-encoded (x 4/3).

export interface PreparedImage {
  mediaType: "image/jpeg";
  data: string; // base64, no data: prefix
  previewUrl: string;
  width: number;
  height: number;
  bytes: number;
}

const MAX_EDGE = 2400;
const MAX_BYTES = 1_900_000;

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

export async function prepareImage(file: File): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      `Your browser cannot open "${file.name}". Try a JPEG or PNG (on iPhone, Settings > Camera > Formats > Most Compatible).`,
    );
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the photo.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob = await toBlob(canvas, 0.88);
  for (const q of [0.78, 0.68, 0.58, 0.48]) {
    if (blob.size <= MAX_BYTES) break;
    blob = await toBlob(canvas, q);
  }
  return {
    mediaType: "image/jpeg",
    data: await blobToBase64(blob),
    previewUrl: URL.createObjectURL(blob),
    width,
    height,
    bytes: blob.size,
  };
}
