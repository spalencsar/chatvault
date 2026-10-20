import hot, { Toaster } from "react-hot-toast";

/** One place for every message ChatVault shows. Errors and confirmations get their own icon, the rest stay plain. */
export function notify(message: string) {
  if (/^error|could not|couldn't|cannot|can't|can only|failed|not found|no longer|denied|unable|too large|not available|not opened|unknown|only (?:files|picture)|no project folder|binary|is a folder/i.test(message)) return hot.error(message);
  if (/copied|saved|synced|restored|forked|ready|done|removed|added|exported|starting|started|moved|opened|pinned|unpinned|archived|renamed|updated|deleted|recycle bin|changed/i.test(message)) return hot.success(message);
  return hot(message);
}

/** An error from a thrown value: the text without the "Error:" prefix, always shown as an error toast. */
export function notifyError(e: unknown) {
  return hot.error(String(e).replace(/^Error:\s*/, ""));
}

/**
 * Runs a chat action the way every menu should: the menu is already closed, a loading toast appears if the work takes
 * a moment (long chats take a while to read), the action reports its own success, and a failure becomes an error toast.
 */
export async function runAction(label: string, work: () => Promise<unknown> | unknown) {
  let id: string | undefined;
  const timer = setTimeout(() => {
    id = hot.loading(`${label}…`);
  }, 250);
  try {
    await work();
  } catch (e) {
    clearTimeout(timer);
    if (id) hot.dismiss(id);
    if (e instanceof DOMException && e.name === "AbortError") return;
    notifyError(e);
    return;
  }
  clearTimeout(timer);
  if (id) hot.dismiss(id);
}

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      gutter={8}
      toastOptions={{
        duration: 3500,
        style: {
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          fontSize: "13px",
          maxWidth: "420px",
          padding: "10px 12px",
          boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
        },
        success: { iconTheme: { primary: "#10b981", secondary: "var(--popover)" } },
        error: { duration: 6000, iconTheme: { primary: "#ef4444", secondary: "var(--popover)" } },
      }}
    />
  );
}

/** A toast that stays up and can be updated while a long job runs. Reuse the same id for every update. */
export function progressToast(id: string, message: string) {
  return hot.loading(message, { id });
}

/** Replaces a progress toast with the result. */
export function finishToast(id: string, message: string, ok = true) {
  return ok ? hot.success(message, { id, duration: 7000 }) : hot.error(message, { id, duration: 8000 });
}
