import { sourceGlyph } from "@/source-icons";
import { ProviderLogo } from "@/claude-logo";
import type { ChatAction } from "@/chat-actions";

/** An action's icon: the tool's modern glyph for "Continue in <tool>", the lucide icon for everything else. */
export function ActionIcon({ action, className }: { action: ChatAction; className?: string }) {
  if (action.logo) {
    return sourceGlyph(action.logo, className) ?? <ProviderLogo provider={action.logo} className={className} />;
  }
  const Icon = action.icon;
  return <Icon className={className} strokeWidth={1.5} />;
}
