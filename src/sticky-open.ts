import { createContext, useCallback, useContext, useState } from "react";

/**
 * Open/closed state that survives a row being scrolled out of the virtual list and back. A row that is removed loses
 * its own state, so without this an expanded message or step group came back collapsed, changing its height and
 * pushing the layout again.
 */
export const StickyOpenContext = createContext<Map<string, boolean> | null>(null);

export function useStickyOpen(key: string | undefined, initial = false) {
  const memo = useContext(StickyOpenContext);
  const [open, setOpenState] = useState(() => (key !== undefined && memo?.has(key) ? (memo.get(key) as boolean) : initial));
  const setOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      setOpenState((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        if (key !== undefined && memo) memo.set(key, next);
        return next;
      });
    },
    [key, memo],
  );
  return [open, setOpen] as const;
}
