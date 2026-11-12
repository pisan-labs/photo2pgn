// Turn and crop a photo before it is read: drag the corners (or the middle)
// of the box with a finger or the mouse. Cropping to the move table gives
// Claude a sharper look at the handwriting.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FULL, editImage, rotatedPreview, type Crop, type PreparedImage, type Rotation } from "../lib/image";

type Handle = "nw" | "ne" | "sw" | "se" | "move";
const MIN = 0.1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function adjustCrop(c: Crop, handle: Handle, dx: number, dy: number): Crop {
  if (handle === "move") {
    return { ...c, x: clamp(c.x + dx, 0, 1 - c.w), y: clamp(c.y + dy, 0, 1 - c.h) };
  }
  let { x, y } = c;
  let right = c.x + c.w;
  let bottom = c.y + c.h;
  if (handle === "nw" || handle === "sw") x = clamp(x + dx, 0, right - MIN);
  if (handle === "ne" || handle === "se") right = clamp(right + dx, x + MIN, 1);
  if (handle === "nw" || handle === "ne") y = clamp(y + dy, 0, bottom - MIN);
  if (handle === "sw" || handle === "se") bottom = clamp(bottom + dy, y + MIN, 1);
  return { x, y, w: right - x, h: bottom - y };
}

export function PhotoEditor({
  page,
  onDone,
  onCancel,
}: {
  page: PreparedImage;
  onDone: (p: PreparedImage) => void;
  onCancel: () => void;
}) {
  const [rotation, setRotation] = useState<Rotation>(page.rotation);
  const [crop, setCrop] = useState<Crop>(page.crop);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Crop } | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    rotatedPreview(page.source, rotation)
      .then((u) => {
        url = u;
        if (live) setPreview(u);
        else URL.revokeObjectURL(u);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [page.source, rotation]);

  const turn = (by: 90 | -90) => {
    setRotation((r) => (((r + by + 360) % 360) as Rotation));
    setCrop(FULL);
  };

  const down = (e: ReactPointerEvent<HTMLElement>) => {
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    if (!handle) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: crop };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!d || !box) return;
    setCrop(adjustCrop(d.start, d.handle, (e.clientX - d.x) / box.width, (e.clientY - d.y) / box.height));
  };
  const up = () => {
    drag.current = null;
  };

  async function apply() {
    setBusy(true);
    try {
      onDone(await editImage(page, rotation, crop));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const pct = (v: number) => `${v * 100}%`;
  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label="Turn and crop the photo">
      <div className="editor-body">
        <p className="hint">Drag the corners to the edges of the move table.</p>
        <div className="editor-frame" ref={frame} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {preview ? <img src={preview} alt="The photo" draggable={false} /> : <div className="spinner" aria-hidden="true" />}
          {preview && (
            <div
              className="crop"
              style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
              data-handle="move"
              onPointerDown={down}
            >
              {(["nw", "ne", "sw", "se"] as const).map((h) => (
                <span key={h} className={`handle ${h}`} data-handle={h} aria-hidden="true" />
              ))}
            </div>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row editor-actions">
          <button type="button" className="secondary" onClick={() => turn(-90)} aria-label="Turn left">
            ⟲ Turn
          </button>
          <button type="button" className="secondary" onClick={() => turn(90)} aria-label="Turn right">
            Turn ⟳
          </button>
          <button type="button" className="link" onClick={() => setCrop(FULL)}>
            Whole photo
          </button>
          <span className="spacer" />
          <button type="button" className="link" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={apply} disabled={busy || !preview}>
            {busy ? "Saving…" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
