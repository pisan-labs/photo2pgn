import { useEffect, useRef, useState } from "react";
import { analyzeGame, type Analysis, type PlyInput } from "./repair";

interface Inputs {
  plies: PlyInput[];
  lang: string;
  edits: Record<number, string>;
}

/**
 * The analysis of a game, computed in a Web Worker. Keeps showing the last
 * result while a new one is computed; `busy` is true meanwhile.
 */
export function useAnalysis(plies: PlyInput[], lang: string, edits: Record<number, string>) {
  const [state, setState] = useState<{ analysis: Analysis | null; inputs: Inputs | null }>({ analysis: null, inputs: null });
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
    const inputs = { plies, lang, edits };
    const onMainThread = () => {
      if (id === seq.current) setState({ analysis: analyzeGame(plies, { lang, edits }), inputs });
    };
    const w = worker.current;
    if (!w) {
      void Promise.resolve().then(onMainThread);
      return;
    }
    const onMessage = (e: MessageEvent<{ id: number; analysis: Analysis }>) => {
      if (e.data.id === id) setState({ analysis: e.data.analysis, inputs });
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onMainThread);
    w.postMessage({ id, plies, lang, edits });
    return () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onMainThread);
    };
  }, [plies, lang, edits]);

  const current = state.inputs;
  const busy = !current || current.plies !== plies || current.lang !== lang || current.edits !== edits;
  return { analysis: state.analysis, busy };
}
