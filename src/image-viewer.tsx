import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { notify, notifyError } from "@/toast";
import { Check, ChevronLeft, ChevronRight, Copy, Download, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Every picture in the open chat, so the viewer can slide between them. */
export const GalleryContext = createContext<{ images: string[]; open: (src: string) => void }>({ images: [], open: () => {} });

const ext = (src: string) => {
  const m = /^data:image\/([a-z0-9+.-]+)/i.exec(src);
  const t = (m?.[1] || "png").toLowerCase();
  return t === "jpeg" ? "jpg" : t.replace("svg+xml", "svg");
};

/** Opens the system Save dialog and writes the picture where the user chooses. */
export async function downloadImage(src: string, n: number) {
  const type = ext(src);
  try {
    const path = await save({ defaultPath: `chatvault-image-${n}.${type}`, filters: [{ name: "Image", extensions: [type] }] });
    if (!path) return;
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
    await invoke("write_image_file", { path, bytes: Array.from(bytes) });
    notify("Image saved");
  } catch (e) {
    notifyError(e);
  }
}

/** Copies the picture itself (as PNG), so it can be pasted into other apps. */
export async function copyImage(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")?.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) throw new Error("copy failed");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function IconBtn({ label, onClick, children, className }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" className={cn("size-8 text-white/80 hover:bg-white/15 hover:text-white", className)} aria-label={label} onClick={onClick} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function useCopied() {
  const [copied, setCopied] = useState(false);
  const run = (src: string) =>
    copyImage(src)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  return [copied, run] as const;
}

/** The size of a picture, read from the first bytes of its data (PNG, GIF, JPEG or WebP), so its space can be kept before it has loaded. */
const sizes = new Map<string, { w: number; h: number } | null>();
function imageSize(src: string): { w: number; h: number } | null {
  if (sizes.has(src)) return sizes.get(src) ?? null;
  let found: { w: number; h: number } | null = null;
  try {
    const comma = src.indexOf(",");
    if (src.startsWith("data:image/") && comma > 0 && src.includes(";base64")) {
      const head = src.slice(comma + 1, comma + 1 + 87380); // about the first 64 KB of the file
      const bin = atob(head.slice(0, head.length - (head.length % 4)));
      const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      if (b[0] === 0x89 && b[1] === 0x50) found = { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
      else if (b[0] === 0x47 && b[1] === 0x49) found = { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
      else if (b[0] === 0xff && b[1] === 0xd8) {
        for (let i = 2; i + 9 < b.length; ) {
          if (b[i] !== 0xff) break;
          const m = b[i + 1];
          if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
            found = { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
            break;
          }
          i += 2 + ((b[i + 2] << 8) | b[i + 3]);
        }
      } else if (b[0] === 0x52 && b[8] === 0x57) {
        const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
        if (kind === "VP8 ") found = { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
        else if (kind === "VP8L") found = { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
        else if (kind === "VP8X") found = { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      }
    }
  } catch {
    found = null;
  }
  if (found && (!(found.w > 0) || !(found.h > 0) || found.w > 60000 || found.h > 60000)) found = null;
  sizes.set(src, found);
  return found;
}

/** A picture in the conversation, with actions that appear on hover. */
export function ChatImage({ src }: { src: string }) {
  const g = useContext(GalleryContext);
  const [copied, copy] = useCopied();
  const n = Math.max(1, g.images.indexOf(src) + 1);
  const size = imageSize(src);
  return (
    <div className="group/img relative inline-block max-w-full overflow-hidden rounded-xl border bg-muted/30 shadow-sm">
      <button type="button" onClick={() => g.open(src)} className="block cursor-zoom-in" aria-label="Open image">
        <img
          src={src}
          alt="Chat attachment"
          decoding="async"
          // Its space is kept from the first frame, so a picture appearing never pushes the messages below it.
          width={size ? Math.round(size.w * Math.min(1, 320 / size.h)) : undefined}
          height={size ? Math.round(size.h * Math.min(1, 320 / size.h)) : undefined}
          style={size ? { aspectRatio: `${size.w} / ${size.h}` } : undefined}
          className="block h-auto max-h-80 max-w-full object-contain"
        />
      </button>
      <div className="absolute right-2 top-2 flex gap-1 rounded-lg bg-black/60 p-1 opacity-0 backdrop-blur transition-opacity focus-within:opacity-100 group-hover/img:opacity-100">
        <IconBtn label="Open full screen" onClick={() => g.open(src)}>
          <Maximize2 className="size-4" />
        </IconBtn>
        <IconBtn label={copied ? "Copied" : "Copy image"} onClick={() => copy(src)}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </IconBtn>
        <IconBtn label="Download" onClick={() => downloadImage(src, n)}>
          <Download className="size-4" />
        </IconBtn>
      </div>
      {g.images.length > 1 && (
        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] tabular-nums text-white/90 backdrop-blur">
          {n} / {g.images.length}
        </span>
      )}
    </div>
  );
}

/** Full-screen viewer: arrow keys or the side buttons slide between the chat's pictures, Esc closes. */
export function Lightbox({ images, index, onIndex, onClose }: { images: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [copied, copy] = useCopied();
  const many = images.length > 1;
  const go = useCallback((d: number) => onIndex((index + d + images.length) % images.length), [index, images.length, onIndex]);

  useEffect(() => setZoom(false), [index]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (many && e.key === "ArrowRight") go(1);
      if (many && e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [go, many, onClose]);

  const src = images[index];
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm" role="dialog" aria-label="Image viewer">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm tabular-nums text-white/70">{many ? `${index + 1} / ${images.length}` : "Image"}</span>
        <div className="flex items-center gap-1">
          <IconBtn label={zoom ? "Fit to screen" : "Actual size"} onClick={() => setZoom((z) => !z)}>
            {zoom ? <ZoomOut className="size-4" /> : <ZoomIn className="size-4" />}
          </IconBtn>
          <IconBtn label={copied ? "Copied" : "Copy image"} onClick={() => copy(src)}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </IconBtn>
          <IconBtn label="Download" onClick={() => downloadImage(src, index + 1)}>
            <Download className="size-4" />
          </IconBtn>
          <IconBtn label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconBtn>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className={cn("flex size-full p-4", zoom ? "overflow-auto" : "items-center justify-center")} onClick={(e) => e.target === e.currentTarget && onClose()}>
          <img
            key={src}
            src={src}
            alt="Chat attachment"
            onClick={() => setZoom((z) => !z)}
            className={cn("m-auto select-none rounded-lg shadow-2xl", zoom ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")}
          />
        </div>
        {many && (
          <>
            <Button variant="ghost" size="icon" className="absolute left-3 top-1/2 size-10 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-white/20 hover:text-white" aria-label="Previous image" onClick={() => go(-1)}>
              <ChevronLeft className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" className="absolute right-3 top-1/2 size-10 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-white/20 hover:text-white" aria-label="Next image" onClick={() => go(1)}>
              <ChevronRight className="size-5" />
            </Button>
          </>
        )}
      </div>

    </div>
  );
}
