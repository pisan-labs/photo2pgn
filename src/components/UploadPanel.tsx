import { useRef, useState } from "react";
import { prepareImage, type PreparedImage } from "../lib/image";
import type { FreeReader } from "../lib/reading";

export type Mode = "free" | "own-key";

interface Props {
  pages: PreparedImage[];
  setPages: (p: PreparedImage[]) => void;
  maxPages: number;
  signInAvailable: boolean;
  signedIn: boolean;
  onOpenSignIn: () => void;
  freeReader: FreeReader;
  mode: Mode;
  setMode: (m: Mode) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  rememberKey: boolean;
  setRememberKey: (r: boolean) => void;
  error: string | null;
  onConvert: () => void;
  onDemo: () => void;
}

export function UploadPanel(p: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) return;
    setFileError(null);
    setLoading(true);
    try {
      const room = p.maxPages - p.pages.length;
      const prepared: PreparedImage[] = [];
      for (const f of list.slice(0, room)) prepared.push(await prepareImage(f));
      p.setPages([...p.pages, ...prepared]);
      if (list.length > room) setFileError(`Only ${p.maxPages} pages per game; the rest were left out.`);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const keyValid = /^sk-ant-\S{10,}$/.test(p.apiKey.trim());
  const freeReady = p.signInAvailable && p.signedIn;
  const canConvert = p.pages.length > 0 && !loading && (p.mode === "free" ? freeReady : keyValid);
  const freeNote =
    p.freeReader === "gateway"
      ? "Read with HintWise's key, within a daily and weekly allowance."
      : "Read by the HintWise reader; it can take a few minutes when it is busy.";

  return (
    <section className="panel upload" aria-labelledby="upload-title">
      <h2 id="upload-title">1. Photograph the scoresheet</h2>
      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        {p.pages.length > 0 && (
          <ul className="pages">
            {p.pages.map((pg, i) => (
              <li key={pg.previewUrl}>
                <img src={pg.previewUrl} alt={`Page ${i + 1}`} />
                <span>Page {i + 1}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() => p.setPages(p.pages.filter((_, j) => j !== i))}
                  aria-label={`Remove page ${i + 1}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {p.pages.length < p.maxPages && (
          <div className="pick">
            <p>
              {p.pages.length === 0
                ? "Flat, in good light, the whole move table in the frame."
                : "Game continues on another page? Add it."}
            </p>
            <div className="row">
              <button type="button" onClick={() => cameraRef.current?.click()} disabled={loading}>
                Take photo
              </button>
              <button type="button" className="secondary" onClick={() => fileRef.current?.click()} disabled={loading}>
                Choose file
              </button>
            </div>
            <p className="hint">or drop an image here</p>
          </div>
        )}
        {loading && <p className="hint">Preparing photo…</p>}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {fileError && <p className="error">{fileError}</p>}

      <h2>2. Choose how it is read</h2>
      <div className="choices" role="radiogroup" aria-label="How it is read">
        <label className={`choice${p.mode === "free" ? " selected" : ""}${p.signInAvailable ? "" : " disabled"}`}>
          <input
            type="radio"
            name="mode"
            checked={p.mode === "free"}
            disabled={!p.signInAvailable}
            onChange={() => p.setMode("free")}
          />
          <span>
            <strong>Free, with a HintWise account</strong>
            {p.signInAvailable ? <small>{freeNote}</small> : <small>Not available in this preview. Use your own key.</small>}
            {p.signInAvailable && !p.signedIn && p.mode === "free" && (
              <button type="button" className="small" onClick={p.onOpenSignIn}>
                Sign in
              </button>
            )}
          </span>
        </label>
        <label className={`choice${p.mode === "own-key" ? " selected" : ""}`}>
          <input type="radio" name="mode" checked={p.mode === "own-key"} onChange={() => p.setMode("own-key")} />
          <span>
            <strong>My own Anthropic API key</strong>
            <small>No account and no allowance; Anthropic bills your account, a few cents a sheet.</small>
          </span>
        </label>
      </div>
      {p.mode === "own-key" && (
        <div className="key">
          <label htmlFor="api-key">API key</label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={p.apiKey}
            onChange={(e) => p.setApiKey(e.target.value)}
          />
          <label className="inline">
            <input type="checkbox" checked={p.rememberKey} onChange={(e) => p.setRememberKey(e.target.checked)} />
            Remember on this device
          </label>
          <p className="hint">
            Your key goes only from this browser to Anthropic; HintWise never sees it. Get one at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            .
          </p>
        </div>
      )}

      {p.error && (
        <p className="error" role="alert">
          {p.error}
        </p>
      )}
      <div className="row actions">
        <button type="button" className="primary" disabled={!canConvert} onClick={p.onConvert}>
          Read scoresheet
        </button>
        <button type="button" className="link" onClick={p.onDemo}>
          Try the demo game instead
        </button>
      </div>
    </section>
  );
}
