// Per-device conveniences in localStorage. Every access may throw (private
// windows, blocked storage), and the app works without it.
export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // unavailable
  }
}
