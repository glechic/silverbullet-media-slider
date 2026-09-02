/**
 * SilverBullet "media-slider" plug.
 *
 * Renders a fenced `media-slider` code block as an interactive media carousel
 * inside a sandboxed iframe (codeWidget with renderMode: iframe).
 *
 * Supported media: images, video, audio, PDF, markdown-file slides, and
 * arbitrary remote URLs. Supports thumbnails, captions, transition effects,
 * autoplay/slideshow, keyboard / wheel / touch navigation, and folder
 * expansion.
 *
 * Inspired by the Obsidian "Media Slider" plugin by amatya-aditya.
 */
import { asset, editor, space } from "@silverbulletmd/silverbullet/syscalls";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";

/** A single media entry to display in the slider. */
interface MediaEntry {
  /** Raw source as written by the user (path, wikilink, or URL). */
  raw: string;
  /** Resolved space path (for local files) or the URL itself (for remote). */
  src: string;
  /** Optional caption text. */
  caption: string | null;
  /** Detected media kind. */
  kind: MediaKind;
  /** True when `src` is an http(s) URL rather than a space path. */
  remote: boolean;
}

type MediaKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "youtube"
  | "unknown";

/** Parsed YAML frontmatter options. */
interface SliderOptions {
  sliderId: string;
  carouselShowThumbnails: boolean;
  thumbnailPosition: "top" | "bottom" | "left" | "right";
  captionMode: "overlay" | "below";
  autoplay: boolean;
  slideshowSpeed: number;
  width: string;
  height: string;
  transitionEffect: string;
  transitionDuration: number;
  enhancedView: boolean;
  fileTypes: string[] | null;
  recursive: boolean;
  showThumbnailToggle: boolean;
  thumbnailsCollapsedByDefault: boolean;
}

const DEFAULT_OPTIONS: SliderOptions = {
  sliderId: "",
  carouselShowThumbnails: true,
  thumbnailPosition: "bottom",
  captionMode: "overlay",
  autoplay: false,
  slideshowSpeed: 0,
  width: "100%",
  height: "380px",
  transitionEffect: "fade",
  transitionDuration: 300,
  enhancedView: true,
  fileTypes: null,
  recursive: false,
  showThumbnailToggle: true,
  thumbnailsCollapsedByDefault: false,
};

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif"];
const VIDEO_EXT = ["mp4", "webm", "mkv", "mov", "ogv"];
const AUDIO_EXT = ["mp3", "ogg", "wav", "flac", "m4a"];
const PDF_EXT = ["pdf"];
const MD_EXT = ["md"];
const DEFAULT_FOLDER_FILTER = [
  ...IMAGE_EXT,
  ...VIDEO_EXT,
  ...AUDIO_EXT,
  ...PDF_EXT,
  ...MD_EXT,
];

let sliderCounter = 0;

/** codeWidget entry point: invoked by SilverBullet for every `media-slider` block. */
export async function mediaSliderWidget(
  body: string,
  _pageName: string,
): Promise<{ html: string; script: string } | null> {
  try {
    const { options, mediaLines } = parseFrontmatter(body);
    const entries = await collectEntries(mediaLines, options);
    if (entries.length === 0) {
      return {
        html: `<div class="ms-empty">No valid media files found in this <code>media-slider</code> block.</div>`,
        script: "",
      };
    }
    return await renderSlider(entries, options);
  } catch (err: any) {
    return {
      html: `<div class="ms-error">media-slider error: ${escapeHtml(
        String(err?.message ?? err),
      )}</div>`,
      script: "",
    };
  }
}

/** Command: short help / pointer to docs. */
export async function mediaSliderHelp(): Promise<void> {
  await editor.flashNotification(
    "media-slider: use a fenced ```media-slider code block. See the plug page for options.",
    "info",
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Split a codeblock body into YAML frontmatter (optional) and media lines. */
function parseFrontmatter(body: string): {
  options: SliderOptions;
  mediaLines: string[];
} {
  const fmMatch = body.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n?/);
  let options: SliderOptions = { ...DEFAULT_OPTIONS };
  let rest = body;
  if (fmMatch) {
    rest = body.slice(fmMatch[0].length);
    try {
      const parsed = parseSimpleYaml(fmMatch[1]);
      options = mergeOptions(options, parsed);
    } catch {
      // ignore malformed frontmatter; fall back to defaults
    }
  }
  const mediaLines = rest
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  return { options, mediaLines };
}

/** A tiny, dependency-free YAML subset parser (keys, lists, scalars, nesting-by-indent). */
function parseSimpleYaml(src: string): any {
  const lines = src.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const root: any = {};
  const stack: { indent: number; obj: any }[] = [{ indent: -1, obj: root }];
  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    let cur = stack[stack.length - 1];
    while (cur && cur.indent >= indent) stack.pop();
    cur = stack[stack.length - 1] ?? { indent: -1, obj: root };
    const target = cur.obj;
    const listMatch = trimmed.match(/^-\s+(.*)$/);
    if (listMatch) {
      if (!Array.isArray(target.__list)) target.__list = [];
      target.__list.push(scalar(listMatch[1]));
      continue;
    }
    const kvMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const valRaw = kvMatch[2];
      if (valRaw === "") {
        const child: any = {};
        target[key] = child;
        stack.push({ indent, obj: child });
      } else {
        target[key] = scalar(valRaw);
      }
    }
  }
  // Promote `__list` arrays into their parent keys.
  return promoteLists(root);
}

function promoteLists(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(promoteLists);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = (v as any)?.__list && Object.keys(v as any).length === 1
      ? (v as any).__list.map(promoteLists)
      : promoteLists(v);
  }
  return out;
}

function scalar(s: string): any {
  s = s.trim().replace(/^['"]|['"]$/g, "");
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function mergeOptions(base: SliderOptions, parsed: any): SliderOptions {
  const out: SliderOptions = { ...base };
  if (!parsed || typeof parsed !== "object") return out;
  for (const key of Object.keys(DEFAULT_OPTIONS) as (keyof SliderOptions)[]) {
    if (parsed[key] !== undefined) {
      (out as any)[key] = parsed[key];
    }
  }
  // Normalize common mistypes.
  if (typeof out.slideshowSpeed === "string")
    out.slideshowSpeed = Number(out.slideshowSpeed) || 0;
  if (typeof out.transitionDuration === "string")
    out.transitionDuration = Number(out.transitionDuration) || 300;
  if (typeof out.autoplay === "string")
    out.autoplay = String(out.autoplay).toLowerCase() === "true";
  if (typeof out.carouselShowThumbnails === "string")
    out.carouselShowThumbnails =
      String(out.carouselShowThumbnails).toLowerCase() === "true";
  if (typeof out.enhancedView === "string")
    out.enhancedView = String(out.enhancedView).toLowerCase() === "true";
  if (typeof out.recursive === "string")
    out.recursive = String(out.recursive).toLowerCase() === "true";
  if (typeof out.showThumbnailToggle === "string")
    out.showThumbnailToggle =
      String(out.showThumbnailToggle).toLowerCase() === "true";
  if (typeof out.thumbnailsCollapsedByDefault === "string")
    out.thumbnailsCollapsedByDefault =
      String(out.thumbnailsCollapsedByDefault).toLowerCase() === "true";
  if (
    out.thumbnailPosition !== "top" &&
    out.thumbnailPosition !== "bottom" &&
    out.thumbnailPosition !== "left" &&
    out.thumbnailPosition !== "right"
  ) {
    out.thumbnailPosition = "bottom";
  }
  if (out.captionMode !== "overlay" && out.captionMode !== "below")
    out.captionMode = "overlay";
  return out;
}

/** Parse media lines (and expand folder references) into MediaEntry objects. */
async function collectEntries(
  mediaLines: string[],
  options: SliderOptions,
): Promise<MediaEntry[]> {
  const expanded: string[] = [];
  for (const line of mediaLines) {
    const folderMatch = line.match(/^\[\[([^]+\/)\]\]$/) || line.match(/^\[\[([^]+)\]\]$/);
    if (folderMatch && folderMatch[1].endsWith("/")) {
      const folderPath = folderMatch[1].replace(/\/$/, "");
      const files = await listFolderMedia(folderPath, options);
      for (const f of files) expanded.push(`![[${f}]]`);
      continue;
    }
    expanded.push(line);
  }

  const entries: MediaEntry[] = [];
  for (const line of expanded) {
    const parsed = parseMediaLine(line);
    if (parsed) {
      entries.push({ ...parsed, kind: await detectKind(parsed.src) });
    }
  }
  return entries;
}

/** Recursively list supported media files under a folder. */
async function listFolderMedia(
  folderPath: string,
  options: SliderOptions,
): Promise<string[]> {
  let files: FileMeta[] = [];
  try {
    files = await space.listFiles();
  } catch {
    return [];
  }
  const prefix = folderPath.endsWith("/") ? folderPath : folderPath + "/";
  const allowed = new Set(
    (options.fileTypes && options.fileTypes.length
      ? options.fileTypes
      : DEFAULT_FOLDER_FILTER
    ).map((e) => e.toLowerCase().replace(/^\./, "")),
  );
  const result: string[] = [];
  for (const f of files) {
    if (f.name === prefix.slice(0, -1)) continue;
    if (!f.path.startsWith(prefix)) continue;
    if (!options.recursive && f.path.slice(prefix.length).includes("/")) continue;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowed.has(ext)) continue;
    result.push(f.path);
  }
  result.sort();
  return result;
}

/** Parse a single media line (wikilink / markdown link / bare path or URL). */
function parseMediaLine(line: string): Omit<MediaEntry, "kind"> | null {
  // ![alt](src) or ![alt](src | caption)
  const mdMatch = line.match(/^!?\[([^\]]*)\]\(([^)]+?)(?:\s*\|\s*([^)]*))?\)$/);
  if (mdMatch) {
    const src = mdMatch[2].trim();
    const alt = mdMatch[1].trim();
    const cap = mdMatch[3] ? mdMatch[3].trim() : alt || null;
    return makeEntry(src, cap);
  }
  // [[path]] or [[path|caption]]
  const wlMatch = line.match(/^!?\[\[([^\]]+?)(?:\|([^\]]+))?\]\]$/);
  if (wlMatch) {
    const src = wlMatch[1].trim();
    const cap = wlMatch[2] ? wlMatch[2].trim() : null;
    return makeEntry(src, cap);
  }
  // Bare URL or path.
  const trimmed = line.trim();
  if (trimmed.length > 0) {
    return makeEntry(trimmed, null);
  }
  return null;
}

function makeEntry(src: string, caption: string | null): Omit<MediaEntry, "kind"> {
  const remote = /^https?:\/\//i.test(src) || /^data:/i.test(src);
  return { raw: src, src, caption, remote };
}

/** Detect the media kind from a path/URL extension or YouTube host. */
async function detectKind(src: string): Promise<MediaKind> {
  if (isYouTubeUrl(src)) return "youtube";
  const ext = src.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (PDF_EXT.includes(ext)) return "pdf";
  if (MD_EXT.includes(ext)) return "markdown";
  if (/^https?:\/\//i.test(src)) {
    // Unknown remote: best-effort via Content-Type.
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(src, { method: "HEAD", signal: controller.signal });
      clearTimeout(t);
      const ct = res.headers.get("Content-Type") ?? "";
      if (ct.startsWith("image/")) return "image";
      if (ct.startsWith("video/")) return "video";
      if (ct.startsWith("audio/")) return "audio";
      if (ct === "application/pdf") return "pdf";
    } catch {
      // fall through
    }
  }
  return "unknown";
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url);
}

function youTubeEmbed(url: string): string {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  return `https://www.youtube.com/embed/${m?.[1] ?? ""}`;
}

function youTubeThumb(url: string): string {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  return `https://img.youtube.com/vi/${m?.[1] ?? ""}/hqdefault.jpg`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Build the {html, script} pair returned to the iframe sandbox. */
async function renderSlider(
  entries: MediaEntry[],
  options: SliderOptions,
): Promise<{ html: string; script: string }> {
  const id = options.sliderId || `ms-${++sliderCounter}`;
  const slides = entries.map((e) => slideDescriptor(e));
  const optsJson = JSON.stringify({ ...options, sliderId: id });

  // Inline the bundled styles.css (decoded) so the iframe has styles
  // immediately, without an async syscall round-trip.
  let css = "";
  try {
    css = await asset.readAsset("media-slider", "styles.css", "utf8");
  } catch (e) {
    console.warn("[media-slider] could not read styles.css asset:", e);
  }

  // Read the Preact UI bundle (esbuild IIFE) to run inside the iframe.
  let uiJs = "";
  try {
    uiJs = await asset.readAsset("media-slider", "slider_ui.js", "utf8");
  } catch (e) {
    console.warn("[media-slider] could not read slider_ui.js asset:", e);
  }

  const htmlParts: string[] = [];
  htmlParts.push(`<style>${css}</style>`);
  htmlParts.push(
    `<div id="${id}"></div>`,
  );
  const html = htmlParts.join("\n");

  // The UI bundle is eval'd as a classic script, so we pass slide/option data
  // as hoisted `var` declarations (visible to the IIFE via closure). Using
  // `var` (not const) is required for the closure trick to work.
  const script = `var __SLIDES = ${JSON.stringify(slides)};\nvar __OPTIONS = ${optsJson};\n${uiJs}`;

  return { html, script };
}

/** Convert an entry into a JSON-friendly descriptor consumed by the runtime. */
function slideDescriptor(e: MediaEntry) {
  if (e.remote) {
    return {
      kind: e.kind,
      src: e.src,
      caption: e.caption,
      remote: true,
      thumb: e.kind === "youtube" ? youTubeThumb(e.src) : null,
      embed: e.kind === "youtube" ? youTubeEmbed(e.src) : null,
    };
  }
  const fsUrl = fsUrlFor(e.src);
  return {
    kind: e.kind,
    src: fsUrl,
    rawPath: e.src,
    caption: e.caption,
    remote: false,
    thumb: e.kind === "image" ? fsUrl : null,
  };
}

/** Resolve a space path to a same-origin /.fs URL (extension-dot encoded for Safari). */
function fsUrlFor(path: string): string {
  const encoded = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  // Encode the final dot of the last segment (Safari header workaround).
  const lastSlash = encoded.lastIndexOf("/");
  const file = encoded.slice(lastSlash + 1);
  const lastDot = file.lastIndexOf(".");
  let fileOut = file;
  if (lastDot > 0) fileOut = file.slice(0, lastDot) + "%2E" + file.slice(lastDot + 1);
  return "/.fs/" + encoded.slice(0, lastSlash + 1) + fileOut;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
