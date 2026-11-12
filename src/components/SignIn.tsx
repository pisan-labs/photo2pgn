// The HintWise sign-in panel from the platform template (Google, or an
// email link; once signed in: the address, Sign out and Delete my account),
// mounted once so a sign-in link in the address bar is finished on arrival.
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { mountSignIn, onAuth } from "../lib/auth";
import { hasSupabase } from "../lib/supabase";

/** The signed-in user; `onSignedIn` runs when someone signs in. */
export function useUser(onSignedIn?: () => void): { user: User | null; available: boolean } {
  const available = hasSupabase();
  const [user, setUser] = useState<User | null>(null);
  const signedIn = useRef(onSignedIn);
  useEffect(() => {
    signedIn.current = onSignedIn;
  });
  useEffect(() => {
    if (!available) return;
    let had = false;
    return onAuth((u) => {
      setUser(u);
      if (u && !had) signedIn.current?.();
      had = Boolean(u);
    });
  }, [available]);
  return { user, available };
}

export function SignInPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasSupabase() || !ref.current) return;
    return mountSignIn(ref.current);
  }, []);
  if (!hasSupabase()) return null;
  return (
    <div className="signin-wrap" hidden={!open}>
      <div className="row signin-head">
        <h2>HintWise account</h2>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">One account for every HintWise app. It is only needed for the free reading.</p>
      <div ref={ref} aria-label="Sign in" />
    </div>
  );
}
