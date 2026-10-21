import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type ImportStats = { added: number; skipped: number; failed: string[] };

export function describeImport(r: ImportStats): string {
  const bits: string[] = [];
  if (r.added) bits.push(`Added ${r.added} ${r.added === 1 ? "chat" : "chats"}`);
  if (r.skipped) bits.push(`${r.skipped} already there`);
  if (r.failed.length) bits.push(`${r.failed.length} failed`);
  if (!bits.length) return "No chats in that selection";
  let msg = bits.join(" · ");
  if (r.failed[0]) msg += `: ${r.failed[0]}`;
  return msg;
}

/** File or folder picker, then copy NousSave JSON/MD into ChatVault. Cancel returns null. */
export async function importNousSave(directory: boolean): Promise<ImportStats | null> {
  const selected = await open({
    title: directory ? "Import a folder of NousSave chats" : "Import NousSave chats",
    multiple: !directory,
    directory,
    filters: directory ? undefined : [{ name: "NousSave", extensions: ["json", "md", "markdown"] }],
  });
  if (selected == null) return null;
  const paths = Array.isArray(selected) ? selected : [selected];
  return invoke<ImportStats>("import_chats", { paths });
}
