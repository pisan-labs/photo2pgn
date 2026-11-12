// A small key-value interface over Netlify Blobs, with an in-memory version
// for tests and local development.
import { getStore } from "@netlify/blobs";

export interface Versioned<T> {
  value: T;
  etag: string;
}

export interface KV {
  getJSON<T>(key: string): Promise<Versioned<T> | null>;
  /** Write; with `onlyIfMatch` or `onlyIfNew`, returns false when the condition fails. */
  setJSON(key: string, value: unknown, cond?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<boolean>;
  getBytes(key: string): Promise<{ data: Uint8Array; metadata: Record<string, unknown> } | null>;
  setBytes(key: string, data: Uint8Array, metadata?: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export function blobsKV(name: string): KV {
  const store = getStore({ name, consistency: "strong" });
  return {
    async getJSON<T>(key: string) {
      const r = await store.getWithMetadata(key, { type: "json" });
      return r ? { value: r.data as T, etag: r.etag ?? "" } : null;
    },
    async setJSON(key, value, cond) {
      const opts = cond?.onlyIfMatch
        ? { onlyIfMatch: cond.onlyIfMatch }
        : cond?.onlyIfNew
          ? { onlyIfNew: true }
          : {};
      const r = await store.setJSON(key, value, opts);
      return r.modified;
    },
    async getBytes(key) {
      const r = await store.getWithMetadata(key, { type: "arrayBuffer" });
      return r ? { data: new Uint8Array(r.data), metadata: r.metadata } : null;
    },
    async setBytes(key, data, metadata = {}) {
      await store.set(key, data.slice().buffer, { metadata });
    },
    async delete(key) {
      await store.delete(key);
    },
    async list(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key);
    },
  };
}

export function memoryKV(): KV {
  const json = new Map<string, { value: string; etag: string }>();
  const bytes = new Map<string, { data: Uint8Array; metadata: Record<string, unknown> }>();
  let version = 0;
  return {
    async getJSON<T>(key: string) {
      const e = json.get(key);
      return e ? { value: JSON.parse(e.value) as T, etag: e.etag } : null;
    },
    async setJSON(key, value, cond) {
      const cur = json.get(key);
      if (cond?.onlyIfNew && cur) return false;
      if (cond?.onlyIfMatch && cur?.etag !== cond.onlyIfMatch) return false;
      json.set(key, { value: JSON.stringify(value), etag: `v${++version}` });
      return true;
    },
    async getBytes(key) {
      return bytes.get(key) ?? null;
    },
    async setBytes(key, data, metadata = {}) {
      bytes.set(key, { data, metadata });
    },
    async delete(key) {
      json.delete(key);
      bytes.delete(key);
    },
    async list(prefix) {
      return [...json.keys(), ...bytes.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}
