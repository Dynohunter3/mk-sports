import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** JSON helpers over AsyncStorage that never throw (storage can be full or unavailable). */
export async function readJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: caching is best-effort
  }
}

export async function removeKeys(keys: string[]): Promise<void> {
  try {
    await AsyncStorage.multiRemove(keys);
  } catch {
    // ignore
  }
}

export async function allKeys(): Promise<readonly string[]> {
  try {
    return await AsyncStorage.getAllKeys();
  } catch {
    return [];
  }
}

/** Tokens go to the Keychain/Keystore on devices; web falls back to localStorage. */
export const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key).catch(() => null);
    return SecureStore.getItemAsync(key).catch(() => null);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, value).catch(() => undefined);
    return SecureStore.setItemAsync(key, value).catch(() => undefined);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key).catch(() => undefined);
    return SecureStore.deleteItemAsync(key).catch(() => undefined);
  },
};
