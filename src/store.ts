import { useCallback, useEffect, useState } from "react";

export const AUTO_SYNC_KEY = "chatvault.autoSync";

/** State that survives closing and reopening the app. */
export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage can be unavailable */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export const chatKey = (c: { provider: string; id: string }) => `${c.provider}:${c.id}`;

/** Pinned chats and custom names, both kept on this PC only. */
/** Names you gave to accounts, kept on this PC. An account without one shows its email or id. */
export function useAccountNames() {
  const [accountNames, setNames] = usePersisted<Record<string, string>>("chatvault.accountNames", {});
  const renameAccount = useCallback(
    (id: string, name: string) =>
      setNames((n) => {
        const next = { ...n };
        if (name.trim()) next[id] = name.trim();
        else delete next[id];
        return next;
      }),
    [setNames],
  );
  return { accountNames, renameAccount };
}

export function useChatMeta() {
  const [pins, setPins] = usePersisted<string[]>("chatvault.pins", []);
  const [names, setNames] = usePersisted<Record<string, string>>("chatvault.names", {});
  const togglePin = useCallback(
    (key: string) => setPins((p) => (p.includes(key) ? p.filter((k) => k !== key) : [key, ...p])),
    [setPins],
  );
  const rename = useCallback(
    (key: string, name: string) =>
      setNames((n) => {
        const next = { ...n };
        if (name.trim()) next[key] = name.trim();
        else delete next[key];
        return next;
      }),
    [setNames],
  );
  return { pins, names, togglePin, rename };
}
