import { useRef, useState } from "react";
import { prepareImage, type PreparedImage } from "../lib/image";
import type { Mode, QuotaInfo } from "../lib/api";

interface Props {
  pages: PreparedImage[];
  setPages: (p: PreparedImage[]) => void;
  maxPages: number;
  quota: QuotaInfo | null;
  mode: Mode;
  setMode: (m: Mode) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  rememberKey: boolean;
  setRememberKey: (r: boolean) => void;
  error: string | null;
  busy: boolean;
  onConvert: () => void;
  onDemo: () => void;
}

function resetText(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
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

  const q = p.quota?.quota;
  const freeAvailable = Boolean(p.quota?.freeAvailable);
  const freeLeft = q?.remaining ?? 0;
  const keyValid = /^sk-ant-\S{10,}$/.test(p.apiKey.trim());
  const canConvert =
    p.pages.length > 0 && !p.busy && !loading && (p.mode === "free" ? freeAvailable && freeLeft > 0 : keyValid);

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

      <h2>2. Choose how to pay for the reading</h2>
      <div className="choices" role="radiogroup" aria-label="API key">
        <label className={`choice${p.mode === "free" ? " selected" : ""}${freeAvailable ? "" : " disabled"}`}>
          <input
            type="radio"
            name="mode"
            checked={p.mode === "free"}
            disabled={!freeAvailable}
            onChange={() => p.setMode("free")}
          />
          <span>
            <strong>Free conversion</strong>
            {!p.quota && <small>Checking availability…</small>}
            {p.quota && !freeAvailable && <small>Not available right now. Use your own key.</small>}
            {q && (
              <small>
                {freeLeft > 0
                  ? `${freeLeft} left (${q.day.limit - q.day.used} of ${q.day.limit} today, ${q.week.limit - q.week.used} of ${q.week.limit} this week).`
                  : q.global.used >= q.global.limit
                    ? `Used up for everyone today; resets ${resetText(q.dayResetsAt)}.`
                    : q.week.used >= q.week.limit
                      ? `This week's ${q.week.limit} are used; resets ${resetText(q.weekResetsAt)}.`
                      : `Today's ${q.day.limit} are used; resets ${resetText(q.dayResetsAt)}.`}
              </small>
            )}
          </span>
        </label>
        <label className={`choice${p.mode === "own-key" ? " selected" : ""}`}>
          <input type="radio" name="mode" checked={p.mode === "own-key"} onChange={() => p.setMode("own-key")} />
          <span>
            <strong>My own Anthropic API key</strong>
            <small>No limits here; Anthropic bills your account, roughly 10 to 20 cents a sheet.</small>
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
            The key goes with this request to Anthropic through our server and is never stored there. Get one at{" "}
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
