import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { finishToast, progressToast } from "@/toast";

/**
 * "Export all chats as Markdown". The work runs in the backend on its own thread; this keeps the latest progress outside
 * any window, so the Sync & backup dialog can be closed and reopened while it runs, and a toast reports the result.
 */
type State = { running: boolean; done: number; total: number; current: string };
let state: State = { running: false, done: 0, total: 0, current: "" };
const subs = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  subs.forEach((f) => f());
};

export const useBulkExport = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
  );

const TOAST = "bulk-export";
let lastToast = 0;
let started = false;

/** Listens for the backend's progress and result. Call once when the app starts. */
export function initBulkExport() {
  if (started) return;
  started = true;
  void listen<{ done: number; total: number; current: string }>("export-progress", (e) => {
    set({ running: true, ...e.payload });
    const { done, total } = e.payload;
    const now = Date.now();
    if (total && (now - lastToast > 500 || done === total)) {
      lastToast = now;
      progressToast(TOAST, `Exporting chats… ${Math.round((done / total) * 100)}% (${done.toLocaleString()} of ${total.toLocaleString()})`);
    }
  });
  void listen<{ written: number; skipped: number; folder: string; seconds: number; error: string | null }>("export-done", (e) => {
    const r = e.payload;
    set({ running: false });
    if (r.error) return void finishToast(TOAST, `Export failed: ${r.error}`, false);
    const skipped = r.skipped ? `, ${r.skipped.toLocaleString()} empty ones skipped` : "";
    finishToast(TOAST, `Exported ${r.written.toLocaleString()} chats as Markdown to ${r.folder}${skipped}`);
  });
  void invoke<boolean>("export_running").then((r) => r && set({ running: true })).catch(() => {});
}

/** Asks for a folder, then starts the export in the background. Files from an earlier export in that folder are replaced. */
export async function startBulkExport(format: "markdown" | "json" = "markdown") {
  const folder = await pickFolder({
    directory: true,
    title: format === "json" ? "Choose a folder for JSON export files" : "Choose a folder for Markdown export files",
  });
  if (!folder || typeof folder !== "string") return;
  try {
    set({ running: true, done: 0, total: 0, current: "" });
    progressToast(TOAST, `Starting the ${format === "json" ? "JSON" : "Markdown"} export…`);
    await invoke(format === "json" ? "export_all_json" : "export_all_markdown", { folder });
  } catch (e) {
    set({ running: false });
    finishToast(TOAST, String(e).replace(/^Error:\s*/, ""), false);
  }
}
