import { useEffect, useRef, useState } from "react";
import { prepareImage, type PreparedImage } from "../lib/image";
import { PhotoEditor } from "./PhotoEditor";
import { accessOptions, outMessage, readyToRead, renewalLine, type AccessOption, type OutOfCredits } from "../lib/access";
import { creditsLine, type Credits } from "../lib/allowance";

/** One game: its photos, one page or two. */
export type Sheet = PreparedImage[];

interface Props {
  /** Each sheet is read as its own game. */
  sheets: Sheet[];
  setSheets: (s: Sheet[]) => void;
  maxPages: number;
  /** 1 when only one game is wanted (a Chess TD hand-off). */
  maxSheets: number;
  /** Sheets are being read in this page: no new reading until they are done. */
  busy?: boolean;
  signInAvailable: boolean;
  signedIn: boolean;
  userEmail?: string | null;
  onOpenSignIn: () => void;
  /** Signed in, and this person's credits are used up until then. */
  out: OutOfCredits | null;
  /** The gateway's count for a signed-in person, when it could be asked. */
  credits?: Credits | null;
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
  /** Offered when credits can be bought (or previewed by an admin). */
  onBuy?: () => void;
}

export function UploadPanel(p: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<{ sheet: number; page: number } | null>(null);
  const took = useRef(false);
  // The sheet that "Add a page" adds to; null: each photo is a new sheet.
  const pageFor = useRef<number | null>(null);
  const many = p.sheets.length > 1;

  async function addFiles(files: FileList | File[] | null) {
    // One game only: every photo is a page of it, as before sheets.
    const to = p.maxSheets === 1 ? 0 : pageFor.current;
    pageFor.current = null;
    if (!files) return;
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) return;
    setFileError(null);
    setLoading(true);
    try {
      const first = p.sheets.length === 0;
      const prepared: PreparedImage[] = [];
      if (to !== null) {
        const room = p.maxPages - (p.sheets[to]?.length ?? 0);
        for (const f of list.slice(0, room)) prepared.push(await prepareImage(f));
        const sheets = p.sheets.length ? p.sheets.map((s, i) => (i === to ? [...s, ...prepared] : s)) : [prepared];
        p.setSheets(sheets);
        if (list.length > room) setFileError(`Only ${p.maxPages} pages per game; the rest were left out.`);
      } else {
        const room = p.maxSheets - p.sheets.length;
        for (const f of list.slice(0, room)) prepared.push(await prepareImage(f));
        p.setSheets([...p.sheets, ...prepared.map((pg) => [pg])]);
        if (list.length > room) setFileError(`Up to ${p.maxSheets} sheets at a time; the rest were left out.`);
      }
      // A sideways or cluttered first photo is the usual case on a phone.
      if (first && prepared.length === 1 && prepared[0].width > prepared[0].height) setEditing({ sheet: 0, page: 0 });
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const options = accessOptions({ signInAvailable: p.signInAvailable, out: Boolean(p.out) });
  const choice: AccessOption = options.includes(p.choice) ? p.choice : options[0];
  const ready = readyToRead({ choice, signedIn: p.signedIn, out: Boolean(p.out), apiKey: p.apiKey });
  const canConvert = ready && p.sheets.length > 0 && !loading && !p.busy;
  const pageCount = p.sheets.reduce((n, s) => n + s.length, 0);
  const roomForSheets = p.maxSheets === 1 ? pageCount < p.maxPages : p.sheets.length < p.maxSheets;
  // Signed in with fewer credits than sheets: the rest would not be read.
  const left = choice === "sign-in" && p.signedIn ? p.credits?.left : null;
  const short = typeof left === "number" && p.sheets.length > left;

  function removePage(i: number, j: number) {
    p.setSheets(p.sheets.map((s, k) => (k === i ? s.filter((_, m) => m !== j) : s)).filter((s) => s.length > 0));
  }
  /** Sheet i is the next page of the game on sheet i - 1. */
  function joinAbove(i: number) {
    p.setSheets(p.sheets.flatMap((s, k) => (k === i ? [] : k === i - 1 ? [[...s, ...p.sheets[i]]] : [s])));
  }
  function addPage(i: number) {
    pageFor.current = i;
    fileRef.current?.click();
  }
  const label = (i: number, j: number) => (many ? `sheet ${i + 1}, page ${j + 1}` : `page ${j + 1}`);

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
      {p.out && (
        <p className="notice">
          {outMessage(p.out)}
          {p.onBuy && (
            <>
              {" "}
              <button type="button" className="link" onClick={p.onBuy}>
                Buy credits
              </button>
            </>
          )}
        </p>
      )}
      {options.length > 1 && (
        <div className="choices" role="radiogroup" aria-label="How Claude reads it">
          <label className={`choice${choice === "sign-in" ? " selected" : ""}`}>
            <input type="radio" name="access" checked={choice === "sign-in"} onChange={() => p.setChoice("sign-in")} />
            <span>
              {/* Signed in, this is the person's credits; signed out, the way to get them. */}
              <strong>{p.signedIn ? creditsLabel(p.credits) : "Sign in"}</strong>
              <small>
                {!p.signedIn
                  ? "With Google or an email link."
                  : (p.credits && creditsLine(p.credits)) || renewalLine()}
              </small>
              {!p.signedIn && choice === "sign-in" && (
                <button type="button" className="small" onClick={p.onOpenSignIn}>
                  Sign in
                </button>
              )}
              {p.signedIn && p.onBuy && (
                <button
                  type="button"
                  className="link buy-more"
                  onClick={(e) => {
                    e.preventDefault(); // inside the label: do not also pick the choice
                    p.onBuy?.();
                  }}
                >
                  Buy more credits
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

      <h2 id="upload-title">{p.maxSheets === 1 ? "2. Photograph the scoresheet" : "2. Photograph the scoresheets"}</h2>
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
        {p.sheets.length > 0 && (
          <ol className={`sheets${many ? " many" : ""}`}>
            {p.sheets.map((sheet, i) => (
              <li key={sheet[0].previewUrl} className="sheet" aria-label={many ? `Sheet ${i + 1}` : undefined}>
                {many && <h3 className="sheet-title">Sheet {i + 1}</h3>}
                <ul className="pages">
                  {sheet.map((pg, j) => (
                    <li key={pg.previewUrl}>
                      <img src={pg.previewUrl} alt={many ? `Sheet ${i + 1}, page ${j + 1}` : `Page ${j + 1}`} />
                      <span>Page {j + 1}</span>
                      <span className="row page-actions">
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => setEditing({ sheet: i, page: j })}
                          aria-label={`Turn or crop ${label(i, j)}`}
                        >
                          Turn / crop
                        </button>
                        <button type="button" className="link" onClick={() => removePage(i, j)} aria-label={`Remove ${label(i, j)}`}>
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                {p.maxSheets > 1 && (sheet.length < p.maxPages || (i > 0 && p.sheets[i - 1].length + sheet.length <= p.maxPages)) && (
                  <span className="row sheet-actions">
                    {sheet.length < p.maxPages && (
                      <button
                        type="button"
                        className="link"
                        disabled={loading || !ready}
                        onClick={() => addPage(i)}
                        aria-label={many ? `Add a page to sheet ${i + 1}` : undefined}
                      >
                        Game goes on? Add page {sheet.length + 1}
                      </button>
                    )}
                    {i > 0 && p.sheets[i - 1].length + sheet.length <= p.maxPages && (
                      <button type="button" className="link" onClick={() => joinAbove(i)}>
                        Same game as sheet {i}
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {roomForSheets && (
          <div className="pick">
            <p>
              {!ready
                ? choice === "sign-in"
                  ? "Sign in first, then take the photo."
                  : "Enter your API key first, then take the photo."
                : p.sheets.length === 0
                  ? p.maxSheets === 1
                    ? "Flat, in good light, the whole move table in the frame."
                    : "Flat, in good light, the whole move table in the frame. Several games? Choose all their photos: each is read as its own game."
                  : p.maxSheets === 1
                    ? "Game continues on another page? Add it."
                    : "Another game? Add its sheet."}
            </p>
            <div className="row capture">
              <button type="button" className="camera" onClick={() => {
                  pageFor.current = null; // a picker closed without a photo leaves no target behind
                  cameraRef.current?.click();
                }}
                disabled={loading || !ready}>
                <span aria-hidden="true">📷</span> Take photo
              </button>
              <button type="button" className="secondary" onClick={() => {
                  pageFor.current = null;
                  fileRef.current?.click();
                }}
                disabled={loading || !ready}>
                {p.maxSheets === 1 ? "Choose a photo" : "Choose photos"}
              </button>
            </div>
            {ready && <p className="hint desktop-only">or drop images here</p>}
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
      {editing !== null && p.sheets[editing.sheet]?.[editing.page] && (
        <PhotoEditor
          page={p.sheets[editing.sheet][editing.page]}
          onCancel={() => setEditing(null)}
          onDone={(edited) => {
            p.setSheets(p.sheets.map((s, i) => (i === editing.sheet ? s.map((pg, j) => (j === editing.page ? edited : pg)) : s)));
            setEditing(null);
          }}
        />
      )}
      {short && (
        <p className="notice">
          You have {left} credit{left === 1 ? "" : "s"}: each sheet takes one, so only the first {left} of these {p.sheets.length} sheets
          can be read.
        </p>
      )}

      {p.error && (
        <p className="error" role="alert">
          {p.error}
        </p>
      )}
      <div className="row actions sticky-actions">
        <button type="button" className="primary" disabled={!canConvert} onClick={p.onConvert}>
          {many ? `Read ${p.sheets.length} scoresheets` : "Read scoresheet"}
        </button>
        <button type="button" className="link" onClick={p.onDemo}>
          Try the demo game instead
        </button>
      </div>
    </section>
  );
}

/** "Use my 3 credits", or "Use my credits" when the count is not known. */
function creditsLabel(c: Credits | null | undefined): string {
  if (c?.left === null || c?.left === undefined) return "Use my credits";
  return `Use my ${c.left} credit${c.left === 1 ? "" : "s"}`;
}
