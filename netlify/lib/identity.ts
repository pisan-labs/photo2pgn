// Who is asking, for the free-conversion caps.
//
// Until sign-in is wired up, a visitor is identified by a salted hash of their
// IP address. That is weak (a whole chess club on one Wi-Fi shares a cap, and
// a phone switching networks gets a fresh one), so sign-in replaces it: once a
// verifier is configured, a signed-in user is counted by account id.

export interface Identity {
  id: string;
  kind: "anonymous" | "user";
}

export type UserVerifier = (bearerToken: string) => Promise<{ id: string } | null>;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function identify(
  req: Request,
  ip: string | undefined,
  salt: string,
  verifyUser?: UserVerifier,
): Promise<Identity> {
  const auth = req.headers.get("authorization");
  if (verifyUser && auth?.startsWith("Bearer ")) {
    const user = await verifyUser(auth.slice(7));
    if (user) return { id: `user:${user.id}`, kind: "user" };
  }
  const hash = await sha256Hex(`${salt}:${ip ?? "unknown"}`);
  return { id: `anon:${hash.slice(0, 32)}`, kind: "anonymous" };
}

export { sha256Hex };
