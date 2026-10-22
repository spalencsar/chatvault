import { useId } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import type { Provider } from "@/chat-actions";

/** Claude-style spark mark, drawn as rotated rounded rays. */
export function ClaudeLogo({ className }: { className?: string }) {
  const rays = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  const lengths = [9, 6, 8, 5.5, 9, 6, 8, 5.5, 9, 6, 8, 5.5];
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      {rays.map((deg, i) => (
        <line
          key={deg}
          x1="16"
          y1={16 - 3}
          x2="16"
          y2={16 - 3 - lengths[i]}
          stroke="#D97757"
          strokeWidth="2.6"
          strokeLinecap="round"
          transform={`rotate(${deg} 16 16)`}
        />
      ))}
    </svg>
  );
}

/** The Codex app icon. */
export function CodexLogo({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true" fillRule="evenodd" clipRule="evenodd" strokeLinejoin="round" strokeMiterlimit={2}>
      <g transform="scale(32)">
        <clipPath id={`${id}a`}>
          <path d="M0 0h16v16H0z" />
        </clipPath>
        <g clipPath={`url(#${id}a)`}>
          <path d="M13.003 0H2.997A3.012 3.012 0 000 2.997v10.006A3.012 3.012 0 002.997 16h10.006A3.012 3.012 0 0016 13.003V2.997A3.012 3.012 0 0013.003 0z" fill="#fff" fillRule="nonzero" />
          <path
            d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.104.104 0 00.043 0 4.556 4.556 0 013.046.275l.047.022.116.057a4.585 4.585 0 012.188 2.399c.209.51.313 1.041.315 1.595.015.412-.03.824-.134 1.223a.124.124 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.12.12 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.109.109 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.438 4.438 0 01-1.945-.466 4.553 4.553 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.797 5.797 0 01-.37-.961 4.575 4.575 0 01-.014-2.298.133.133 0 00.006-.056.083.083 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.898 3.898 0 01-.251-1.192 5.193 5.193 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33a6.29 6.29 0 01.646-.227.1.1 0 00.065-.066 4.512 4.512 0 01.829-1.615 4.54 4.54 0 011.837-1.388zm3.482 10.565a.64.64 0 00-.601.636.64.64 0 00.601.636h3.636l.036.001a.64.64 0 00.637-.637.64.64 0 00-.637-.637l-.036.001h-3.636zM8.462 9.23a.64.64 0 00-.543-.304.64.64 0 00-.563.935l1.272 2.224-1.266 2.136a.638.638 0 001.095.649l1.454-2.455a.637.637 0 00.005-.64L8.462 9.23z"
            fill={`url(#${id}g)`}
            fillRule="nonzero"
            transform="scale(.66667)"
          />
        </g>
      </g>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(0 18 -18 0 12 3)">
          <stop offset="0" stopColor="#b1a7ff" />
          <stop offset=".5" stopColor="#7a9dff" />
          <stop offset="1" stopColor="#3941ff" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Cursor's cube mark. */
export function CursorLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9z" fill="currentColor" />
      <path d="M12 12 20.5 7.5M12 12v9.5M12 12 3.5 7.5" stroke="var(--background)" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

/** The ChatVault app icon: a chat bubble with three dots. */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true">
      <rect width="1024" height="1024" rx="230" fill="#18181b" />
      <rect x="196" y="230" width="632" height="410" rx="110" fill="#fafafa" />
      <polygon points="330,610 330,800 500,630" fill="#fafafa" />
      <circle cx="352" cy="435" r="44" fill="#18181b" />
      <circle cx="512" cy="435" r="44" fill="#18181b" />
      <circle cx="672" cy="435" r="44" fill="#18181b" />
    </svg>
  );
}


const GEMINI_FRAME = "M419.776 0.00781248C470.82 0.654592 512 42.2332 512 93.4296V418.572L511.992 419.776C511.344 470.82 469.768 512 418.572 512H93.4296C41.83 512 0.00052574 470.168 0 418.572V93.4296C0.000523248 42.2332 41.1792 0.654596 92.2228 0.00781248L93.4296 0H418.572L419.776 0.00781248ZM93.4296 29.8984C58.3424 29.899 29.899 58.3424 29.8984 93.4296V418.572C29.899 453.656 58.3424 482.1 93.4296 482.1H418.572C453.656 482.1 482.1 453.656 482.1 418.572V93.4296C482.1 58.3424 453.656 29.899 418.572 29.8984H93.4296ZM357.926 223.129V301.274L154.754 398.949V342.297L321.199 262.199L154.754 182.106V125.453L357.926 223.129Z";

/** The Gemini CLI icon: a dark rounded tile with a gradient frame and a prompt arrow. */
export function GeminiLogo({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 512 512" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}a`} x1="119.591" y1="257.869" x2="393.343" y2="257.869" gradientUnits="userSpaceOnUse">
          <stop offset="0.0196292" stopColor="#406AFB" />
          <stop offset="0.226827" stopColor="#078EFB" />
          <stop offset="0.418757" stopColor="#939AFF" />
          <stop offset="0.584515" stopColor="#D698FC" />
          <stop offset="0.774264" stopColor="#FA6178" />
          <stop offset="0.97928" stopColor="#F2554F" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="257.869" x2="512" y2="257.869" gradientUnits="userSpaceOnUse">
          <stop stopColor="#217BFE" />
          <stop offset="0.335283" stopColor="#078EFB" />
          <stop offset="0.7" stopColor="#AC87EB" />
          <stop offset="1" stopColor="#EE4D5D" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="93.4" fill="#1E1E2E" />
      <path d={GEMINI_FRAME} fill={`url(#${id}a)`} />
      <path d={GEMINI_FRAME} fill={`url(#${id}b)`} />
    </svg>
  );
}

/** The OpenCode mark in its two official colourings: the dark one on light themes, the light one on dark themes. */
export function OpenCodeLogo({ className }: { className?: string }) {
  const inner = "M180 240H60V120H180V240Z";
  const frame = "M180 60H60V240H180V60ZM240 300H0V0H240V300Z";
  return (
    <>
      <svg viewBox="0 0 240 300" className={cn("dark:hidden", className)} fill="none" aria-hidden="true">
        <path d={inner} fill="#CFCECD" />
        <path d={frame} fill="#211E1E" />
      </svg>
      <svg viewBox="0 0 240 300" className={cn("hidden dark:block", className)} fill="none" aria-hidden="true">
        <path d={inner} fill="#4B4646" />
        <path d={frame} fill="#F1ECEC" />
      </svg>
    </>
  );
}

const CLINE_BOT = "M56 6.39844C62.0667 6.39844 66.4004 10.8825 66.4004 16.4609C66.4003 18.0033 66.0624 20.0605 65.5117 22.3984H83.0117C88.4176 22.3984 92.7997 26.7807 92.7998 32.1865V45.8643L105.068 58.6445C105.365 58.9541 105.366 59.4434 105.068 59.7529L92.7998 72.5312V86.21C92.7998 91.6159 88.4176 95.998 83.0117 95.998H28.9883C23.5824 95.998 19.2002 91.6158 19.2002 86.21V72.5312L6.93164 59.7529C6.63461 59.4434 6.63474 58.9541 6.93164 58.6445L19.2002 45.8643V32.1865C19.2003 26.7807 23.5825 22.3985 28.9883 22.3984H46.4883C45.9376 20.0605 45.5997 18.0033 45.5996 16.4609C45.5996 10.8826 49.9334 6.39851 56 6.39844ZM40.9092 44.7988C38.0376 44.799 35.7102 47.1265 35.71 49.998V68.3984C35.71 71.2702 38.0375 73.5984 40.9092 73.5986C43.7811 73.5986 46.1094 71.2703 46.1094 68.3984V49.998C46.1092 47.1263 43.7809 44.7988 40.9092 44.7988ZM70.5098 44.7988C67.638 44.7988 65.3098 47.1263 65.3096 49.998V68.3984C65.3096 71.2703 67.6379 73.5986 70.5098 73.5986C73.3816 73.5985 75.71 71.2703 75.71 68.3984V49.998C75.7097 47.1264 73.3814 44.7989 70.5098 44.7988Z";

/** The Cline bot mark: dark on light themes, white on dark themes (the two official colourings). */
export function ClineLogo({ className }: { className?: string }) {
  return (
    <>
      <svg viewBox="0 0 112 112" className={cn("dark:hidden", className)} fill="none" aria-hidden="true">
        <path d={CLINE_BOT} fill="#1C1C24" />
      </svg>
      <svg viewBox="0 0 112 112" className={cn("hidden dark:block", className)} fill="none" aria-hidden="true">
        <path d={CLINE_BOT} fill="#FFFFFF" />
      </svg>
    </>
  );
}

/** The logos of several tools overlapping each other as a shadcn avatar group. Used for "all tools". */
export function ProviderStack({ providers, max = 4, className }: { providers: Provider[]; max?: number; className?: string }) {
  const shown = providers.slice(0, max);
  const rest = providers.length - shown.length;
  return (
    <AvatarGroup className={cn("-space-x-1.5 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background dark:*:data-[slot=avatar]:ring-[color-mix(in_oklab,var(--input)_30%,var(--background))]", className)} aria-hidden>
      {shown.map((p) => (
        <Avatar key={p} size="sm" className="size-6 after:hidden">
          <AvatarFallback className="bg-muted p-[5px] dark:bg-neutral-800">
            <ProviderLogo provider={p} className="size-full" />
          </AvatarFallback>
        </Avatar>
      ))}
      {rest > 0 && <AvatarGroupCount className="size-6 bg-muted text-[10px] font-medium ring-2 ring-background dark:bg-neutral-800 dark:ring-[color-mix(in_oklab,var(--input)_30%,var(--background))]">+{rest}</AvatarGroupCount>}
    </AvatarGroup>
  );
}

/** The official Grok symbol, using the light or dark foreground colour. */
export function GrokLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        className="fill-foreground"
        d="m24 .389-3.3 3.33v-.01L9.27 15.295l7.978-5.943c.391-.292.95-.178 1.137.275.98 2.387.541 5.255-1.41 7.225s-4.667 2.401-7.149 1.418l-2.71 1.267c3.888 2.683 8.61 2.02 11.562-.96 2.34-2.363 3.064-5.583 2.386-8.487l.008.006c-.983-4.266.241-5.97 2.75-9.457zM11.922 3.115A8.93 8.93 0 0 0 5.984 5.76c-2.533 2.556-3.33 6.487-1.963 9.842 1.022 2.507-.652 4.28-2.34 6.07-.597.634-1.198 1.268-1.681 1.94l7.621-6.87.002-.002c-2.791-2.69-2.311-6.856.07-9.258C9.455 5.705 12.34 4.98 14.86 6.047l2.705-1.262a7.8 7.8 0 0 0-1.828-1.006 8.9 8.9 0 0 0-3.814-.664"
      />
    </svg>
  );
}

/** Inbox mark for chats brought in from NousSave and similar exports. */
export function ImportedLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect width="24" height="24" rx="5" className="fill-sky-500/20" />
      <path d="M5.5 12.5 8 15.5h8l2.5-3V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5.5 18v-5.5Z" className="stroke-sky-600 dark:stroke-sky-400" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 5.5v8M9 10.5 12 13.5 15 10.5" className="stroke-sky-600 dark:stroke-sky-400" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Hermes Agent mark: a compact monochrome profile inspired by its Nous brand badge. */
export function HermesLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect x="1" y="1" width="22" height="22" rx="5" className="fill-foreground" />
      <path d="M7 18.5V9.2C7 5.8 9.2 4 12.4 4c3.5 0 5.6 2.1 5.6 5.5v9h-3.1v-4.4H10v4.4H7Zm3-7.1h4.9V9.6c0-1.8-.9-2.8-2.5-2.8S10 7.8 10 9.6v1.8Z" className="fill-background" />
      <path d="M5.1 8.2c1.4-2.6 3.8-4.3 7-4.3 3.5 0 5.9 1.6 7.2 4.5-1.5-1.4-3.5-2.1-5.8-2.1-3.1 0-5.8.8-8.4 1.9Z" className="fill-amber-400" />
    </svg>
  );
}

export function ProviderLogo({ provider, className }: { provider: Provider; className?: string }) {
  if (provider === "claude") return <ClaudeLogo className={className} />;
  if (provider === "codex") return <CodexLogo className={className} />;
  if (provider === "cursor") return <CursorLogo className={className} />;
  if (provider === "gemini") return <GeminiLogo className={className} />;
  if (provider === "opencode") return <OpenCodeLogo className={className} />;
  if (provider === "grok") return <GrokLogo className={className} />;
  if (provider === "hermes") return <HermesLogo className={className} />;
  if (provider === "imported") return <ImportedLogo className={className} />;
  return <ClineLogo className={className} />;
}

/** Use the original platform mark for imported chats when ChatVault has one. */
export function visualProvider(provider: Provider, account?: string): Provider {
  if (provider !== "imported") return provider;
  const platform = account?.trim().toLowerCase();
  if (platform === "grok" || platform === "xai" || platform === "x.ai") return "grok";
  if (platform === "gemini" || platform === "google gemini") return "gemini";
  return "imported";
}

/** The GitHub mark. */
export function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
