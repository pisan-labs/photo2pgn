import { useEffect, useRef, useState } from "react";
import { prepareImage, type PreparedImage } from "../lib/image";
import { PhotoEditor } from "./PhotoEditor";
import { accessOptions, outMessage, readyToRead, renewalLine, type AccessOption, type OutOfCredits } from "../lib/access";

interface Props {
  pages: PreparedImage[];
  setPages: (p: PreparedImage[]) => void;
  maxPages: number;
  signInAvailable: boolean;
  signedIn: boolean;
  userEmail?: string | null;
  onOpenSignIn: () => void;
  /** Signed in, and this person's credits are used up until then. */
  out: OutOfCredits | null;
  choice: AccessOption;
  setChoice: (c: AccessOption) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  rememberKey: boolean;
  setRememberKey: (r: boolean) => void;
  error: string | null;
  onConvert: () => void;
  onDemo: () => void;
  /** Photos handed over by the share sheet, to add once. */
  incoming?: File[];
}

export function UploadPanel(p: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const took = useRef(false);

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
      // A sideways or cluttered first photo is the usual case on a phone.
      if (p.pages.length === 0 && prepared.length === 1 && prepared[0].width > prepared[0].height) setEditing(0);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const options = accessOptions({ signInAvailable: p.signInAvailable, out: Boolean(p.out) });
  const choice: AccessOption = options.includes(p.choice) ? p.choice : options[0];
  const ready = readyToRead({ choice, signedIn: p.signedIn, out: Boolean(p.out), apiKey: p.apiKey });
  const canConvert = ready && p.pages.length > 0 && !loading;

  // Photos shared in from the gallery wait until there is a way to read them.
  useEffect(() => {
    if (ready && p.incoming?.length && !took.current) {
      took.current = true;
      void addFiles(p.incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.incoming, ready]);

  return (
    <section className="panel upload" aria-labelledby="access-title">
      <h2 id="access-title">
        {options.length === 1 ? "1. Your Anthropic API key" : p.signedIn ? "1. Choose how to read it" : "1. Sign in, or use your own key"}
      </h2>
      {p.out && <p className="notice">{outMessage(p.out)}</p>}
      {options.length > 1 && (
        <div className="choices" role="radiogroup" aria-label="How Claude reads it">
          <label className={`choice${choice === "sign-in" ? " selected" : ""}`}>
            <input type="radio" name="access" checked={choice === "sign-in"} onChange={() => p.setChoice("sign-in")} />
            <span>
              {/* Signed in, this is the person's credits; signed out, the way to get them. */}
              <strong>{p.signedIn ? "Use my credits" : "Sign in"}</strong>
              <small>{p.signedIn ? renewalLine() : "With Google or an email link."}</small>
              {!p.signedIn && choice === "sign-in" && (
                <button type="button" className="small" onClick={p.onOpenSignIn}>
                  Sign in
                </button>
              )}
            </span>
          </label>
          <label className={`choice${choice === "own-key" ? " selected" : ""}`}>
            <input type="radio" name="access" checked={choice === "own-key"} onChange={() => p.setChoice("own-key")} />
            <span>
              <strong>Use my own Anthropic key</strong>
              <small>A few cents a sheet, billed by Anthropic.</small>
            </span>
          </label>
        </div>
      )}
      {choice === "own-key" && (
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
            It goes only from this browser to Anthropic. Get one at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            .
          </p>
        </div>
      )}

      <h2 id="upload-title">2. Photograph the scoresheet</h2>
      <div
        className={`dropzone${dragging ? " dragging" : ""}${ready ? "" : " disabled"}`}
        aria-disabled={!ready}
        onDragOver={(e) => {
          e.preventDefault();
          if (ready) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (ready) void addFiles(e.dataTransfer.files);
        }}
      >
        {p.pages.length > 0 && (
          <ul className="pages">
            {p.pages.map((pg, i) => (
              <li key={pg.previewUrl}>
                <img src={pg.previewUrl} alt={`Page ${i + 1}`} />
                <span>Page {i + 1}</span>
                <span className="row page-actions">
                  <button type="button" className="secondary small" onClick={() => setEditing(i)} aria-label={`Turn or crop page ${i + 1}`}>
                    Turn / crop
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => p.setPages(p.pages.filter((_, j) => j !== i))}
                    aria-label={`Remove page ${i + 1}`}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {p.pages.length < p.maxPages && (
          <div className="pick">
            <p>
              {!ready
                ? choice === "sign-in"
                  ? "Sign in first, then take the photo."
                  : "Enter your API key first, then take the photo."
                : p.pages.length === 0
                  ? "Flat, in good light, the whole move table in the frame."
                  : "Game continues on another page? Add it."}
            </p>
            <div className="row capture">
              <button type="button" className="camera" onClick={() => cameraRef.current?.click()} disabled={loading || !ready}>
                <span aria-hidden="true">📷</span> Take photo
              </button>
              <button type="button" className="secondary" onClick={() => fileRef.current?.click()} disabled={loading || !ready}>
                Choose a photo
              </button>
            </div>
            {ready && <p className="hint desktop-only">or drop an image here</p>}
          </div>
        )}
        {loading && <p className="hint">Preparing photo…</p>}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          disabled={!ready}
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
          disabled={!ready}
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {fileError && <p className="error">{fileError}</p>}
      {editing !== null && p.pages[editing] && (
        <PhotoEditor
          page={p.pages[editing]}
          onCancel={() => setEditing(null)}
          onDone={(edited) => {
            p.setPages(p.pages.map((pg, j) => (j === editing ? edited : pg)));
            setEditing(null);
          }}
        />
      )}

      {p.error && (
        <p className="error" role="alert">
          {p.error}
        </p>
      )}
      <div className="row actions sticky-actions">
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
