import { invoke } from "@tauri-apps/api/core";

export async function launchCli(args: { agent: string; id: string; cwd: string | null; [key: string]: unknown }) {
  const { ensureCli } = await import("@/cli-setup");
  if (!await ensureCli(args.agent.split("-")[0])) throw new DOMException("Launch cancelled.", "AbortError");
  await invoke("launch_agent", args);
}
