/** Key-value persistence (AsyncStorage on devices; tests inject an in-memory store). */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  keys(): Promise<string[]>;
}

let impl: KV | null = null;

export function setKV(kv: KV) {
  impl = kv;
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    remove: async (ks) => ks.forEach((k) => m.delete(k)),
    keys: async () => [...m.keys()],
  };
}

function kv(): KV {
  if (!impl) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AS = require('@react-native-async-storage/async-storage').default;
    impl = {
      get: (k) => AS.getItem(k),
      set: (k, v) => AS.setItem(k, v),
      remove: (ks) => AS.multiRemove(ks),
      keys: async () => [...(await AS.getAllKeys())],
    };
  }
  return impl!;
}

export async function readKV<T>(key: string): Promise<T | null> {
  try {
    const raw = await kv().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeKV(key: string, value: unknown): Promise<void> {
  try {
    await kv().set(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: the app keeps working from memory
  }
}

export async function removeKV(prefixOrKeys: string | string[]): Promise<void> {
  try {
    const keys = Array.isArray(prefixOrKeys) ? prefixOrKeys : (await kv().keys()).filter((k) => k.startsWith(prefixOrKeys));
    if (keys.length) await kv().remove(keys);
  } catch {
    // ignore
  }
}
