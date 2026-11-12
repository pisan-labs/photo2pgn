// Who is asking: the HintWise (Supabase) user behind a session token. The
// browser sends its session token as "Authorization: Bearer ..."; Supabase
// Auth says whose it is. The server never sees a password or a service key.

export type UserVerifier = (bearerToken: string) => Promise<{ id: string } | null>;

export function supabaseVerifier(url: string, anonKey: string, fetchFn: typeof fetch = fetch): UserVerifier {
  return async (token) => {
    if (!token) return null;
    try {
      const res = await fetchFn(`${url.replace(/\/$/, "")}/auth/v1/user`, {
        headers: { apikey: anonKey, authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const user = (await res.json()) as { id?: unknown };
      return typeof user.id === "string" && user.id ? { id: user.id } : null;
    } catch {
      return null;
    }
  };
}

export async function userFrom(req: Request, verify: UserVerifier): Promise<{ id: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? verify(auth.slice(7).trim()) : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
