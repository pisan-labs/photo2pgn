// photo2pgn.hintwise.org/install: the link to send people to put the app on
// their phone. Browsers let a page open the install dialog only from a tap,
// and iPhones not at all, so this is as close to one tap as the web allows.
import { useState } from "react";
import { iosShareHint, type InstallWay } from "../lib/install";

export function InstallPanel({
  way,
  installed,
  onInstall,
  onContinue,
  ua = navigator.userAgent,
  link = `${window.location.origin}/install`,
}: {
  way: InstallWay;
  /** Installed from this page just now. */
  installed: boolean;
  onInstall: () => void;
  onContinue: () => void;
  ua?: string;
  link?: string;
}) {
  const [copied, setCopied] = useState(false);
  // The browser's dialog opens once per page: after the tap, the menu is the way left.
  const [asked, setAsked] = useState(false);
  const done = way === "installed" || installed;
  const copy = () => {
    void navigator.clipboard
      ?.writeText(link)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  const copyButton = (
    <button type="button" className="secondary small" onClick={copy}>
      {copied ? "Link copied" : "Copy link"}
    </button>
  );

  return (
    <section className="panel install" aria-labelledby="install-title">
      <img className="install-icon" src="/icons/hintwise-icon-192.png" alt="" width="72" height="72" />
      <h2 id="install-title">Install Photo to PGN</h2>
      <p className="lede">
        Put it on your home screen: it opens full screen like an app
        {way === "ios" ? "." : ", and on Android you can share a scoresheet photo straight into it from your gallery."}
      </p>

      {done && (
        <p className="ok-note" role="status">
          {installed ? "Installed. Photo to PGN is on your home screen." : "Photo to PGN is installed: you are using it now."}
        </p>
      )}

      {way === "prompt" && !installed && (
        <div className="install-go">
          <button
            type="button"
            className="primary big"
            onClick={() => {
              setAsked(true);
              onInstall();
            }}
          >
            Install Photo to PGN
          </button>
          <p className="hint">Your phone asks once more: tap Install.</p>
        </div>
      )}

      {way === "ios" && !done && (
        <>
          <ol className="install-steps">
            <li>Tap {iosShareHint(ua)}.</li>
            <li>
              Scroll down and tap <strong>Add to Home Screen</strong>.
            </li>
            <li>
              Tap <strong>Add</strong>.
            </li>
          </ol>
          <p className="hint">
            No Add to Home Screen? The page may have opened inside another app (Gmail, WhatsApp, Instagram): copy the link and
            open it in Safari. {copyButton}
          </p>
        </>
      )}

      {way === "android-menu" && !done && (
        <>
          {asked && <p>Closed the dialog? You can still install it from the browser's menu:</p>}
          <ol className="install-steps">
            <li>
              Open the browser's menu: <strong>⋮</strong> at the top right in Chrome, <strong>≡</strong> at the bottom in Samsung
              Internet.
            </li>
            <li>
              Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
            </li>
            <li>Confirm.</li>
          </ol>
          <p className="hint">
            Opened inside another app (Gmail, WhatsApp, Instagram)? Copy the link and open it in Chrome. {copyButton}
          </p>
        </>
      )}

      {way === "desktop" && !done && (
        <p>
          Open this page on your phone: <strong className="install-link">{link.replace(/^https?:\/\//, "")}</strong> {copyButton}
        </p>
      )}

      <p>
        <button type="button" className="link" onClick={onContinue}>
          {done ? "Go to Photo to PGN" : "Use it in the browser instead"}
        </button>
      </p>
    </section>
  );
}
