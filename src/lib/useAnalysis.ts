import { useEffect, useRef, useState } from "react";
import { analyzeGame, type Analysis, type PlyInput } from "./repair";

/**
 * The analysis of a game, computed in a Web Worker. Keeps showing the last
 * result while a new one is computed; `busy` is true meanwhile.
 */
export function useAnalysis(plies: PlyInput[], lang: string, edits: Record<number, string>) {
  const [state, setState] = useState<{ analysis: Analysis | null; busy: boolean }>({ analysis: null, busy: true });
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    try {
      worker.current = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    } catch {
      worker.current = null; // no workers: compute on the main thread
    }
    return () => worker.current?.terminate();
  }, []);

  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, busy: true }));
    const w = worker.current;
    if (!w) {
      setState({ analysis: analyzeGame(plies, { lang, edits }), busy: false });
      return;
    }
    const onMessage = (e: MessageEvent<{ id: number; analysis: Analysis }>) => {
      if (e.data.id === seq.current) setState({ analysis: e.data.analysis, busy: false });
    };
    const onError = () => {
      if (id === seq.current) setState({ analysis: analyzeGame(plies, { lang, edits }), busy: false });
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, plies, lang, edits });
    return () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
  }, [plies, lang, edits]);

  return state;
}
