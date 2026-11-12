// Runs the move analysis off the main thread: a sheet in poor handwriting
// can take a second or so, and the page should stay responsive meanwhile.
import { analyzeGame, type PlyInput } from "./repair";

self.onmessage = (e: MessageEvent<{ id: number; plies: PlyInput[]; lang: string; edits: Record<number, string> }>) => {
  const { id, plies, lang, edits } = e.data;
  const analysis = analyzeGame(plies, { lang, edits });
  (self as unknown as Worker).postMessage({ id, analysis });
};
