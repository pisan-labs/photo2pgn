// photo2pgn's logo (src/assets/logo.svg, owner 15 Nov): the favicon of every page is it, inline.
import { readFileSync } from "node:fs";

/** src/assets/logo.svg on one line, with single quotes, as it is inlined. */
export function logoSvg(): string {
  return readFileSync("src/assets/logo.svg", "utf8").trim().replace(/>\s+</g, "><").replace(/\s+/g, " ").replaceAll('"', "'");
}

/** The SVG inside a page's <link rel="icon" href="data:image/svg+xml,...">. */
export function faviconSvg(html: string): string | null {
  const m = html.match(/<link rel="icon" href="data:image\/svg\+xml,([^"]*)"/);
  return m ? decodeURIComponent(m[1]) : null;
}
