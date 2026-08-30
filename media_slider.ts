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
  // Pre-serialize the slide model for the client script.
  const slides = entries.map((e) => slideDescriptor(e));
  const dataAttr = escapeHtml(JSON.stringify(slides));
  const optsAttr = escapeHtml(JSON.stringify({ ...options, sliderId: id }));

  // Inline the bundled styles.css (decoded) so the iframe has styles
  // immediately, without an async syscall round-trip.
  let css = "";
  try {
    css = await asset.readAsset("media-slider", "styles.css", "utf8");
  } catch (e) {
    console.warn("[media-slider] could not read styles.css asset:", e);
  }

  const htmlParts: string[] = [];
  htmlParts.push(`<style>${css}</style>`);
  htmlParts.push(
    `<div class="media-slider-wrapper" id="${id}" data-slides="${dataAttr}" data-options="${optsAttr}"></div>`,
  );
  const html = htmlParts.join("\n");

  const script = SLIDER_RUNTIME;
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

// The runtime is eval'd inside the iframe. It reads the bundled styles.css
// asset and mounts the interactive slider into the wrapper element.
const SLIDER_RUNTIME = `
(function () {
  console.log("[media-slider] widget runtime starting");

  const root = document.querySelector(".media-slider-wrapper");
  if (!root) {
    console.error("[media-slider] wrapper element not found");
    return;
  }
  try {
    const slides = JSON.parse(root.getAttribute("data-slides") || "[]");
    const opts = JSON.parse(root.getAttribute("data-options") || "{}");
    root.removeAttribute("data-slides");
    root.removeAttribute("data-options");
    console.log("[media-slider] booting", slides.length, "slides");
    bootSlider(root, slides, opts);
  } catch (e) {
    console.error("[media-slider] boot failed:", e);
    root.innerHTML =
      '<div class="ms-error">media-slider failed to render: ' +
      String(e && e.message ? e.message : e) + "</div>";
  }
})();

function bootSlider(root, slides, opts) {
  const TRANSITIONS = ["fade","slide","zoom","slide-up","slide-down","flip","flip-vertical","rotate","blur","squeeze"];
  const effect = TRANSITIONS.includes(opts.transitionEffect) ? opts.transitionEffect : "fade";
  const dur = Math.max(0, Number(opts.transitionDuration) || 300);
  const verticalThumbs = opts.thumbnailPosition === "left" || opts.thumbnailPosition === "right";

  root.style.setProperty("--slider-width", opts.width);
  root.style.setProperty("--slider-height", opts.height);
  root.style.setProperty("--transition-duration", dur + "ms");
  root.classList.add(opts.thumbnailPosition === "left" || opts.thumbnailPosition === "right" ? "flex-row" : "flex-column");

  const content = el("div", "slider-content");
  const container = el("div", "slider-container");
  const mediaWrap = el("div", "media-wrapper");
  const captionWrap = el("div", "slider-caption-container");
  container.appendChild(mediaWrap);
  content.appendChild(container);
  content.appendChild(captionWrap);

  // Thumbnails.
  let thumbContainer = null;
  let thumbEls = [];
  if (opts.carouselShowThumbnails) {
    thumbContainer = el("div", "thumbnail-container " + (verticalThumbs ? "vertical" : "horizontal"));
  }

  // Nav buttons.
  const prevBtn = el("button", "slider-btn prev");
  prevBtn.innerHTML = iconChevronLeft();
  prevBtn.title = "Previous";
  const nextBtn = el("button", "slider-btn next");
  nextBtn.innerHTML = iconChevronRight();
  nextBtn.title = "Next";
  content.appendChild(prevBtn);
  content.appendChild(nextBtn);

  // Enhanced-view controls (fullscreen + copy link).
  if (opts.enhancedView) {
    const fsBtn = el("button", "fullscreen-btn");
    fsBtn.innerHTML = iconMaximize();
    fsBtn.title = "Fullscreen";
    // SilverBullet renders this widget inside a fixed-height iframe. The
    // original plugin could fullscreen its wrapper directly, but here that
    // only fills the iframe's small box. So we fullscreen the iframe element
    // itself (same-origin about:blank → reachable via globalThis.frameElement)
    // and toggle a class to expand the slider to fill it.
    const target = globalThis.frameElement || root;
    let isFs = false;
    let savedIframeStyle = "";
    let savedBodyStyle = "";
    let savedHtmlStyle = "";
    const enterFs = () => {
      isFs = true;
      root.classList.add("ms-fullscreen");
      container.classList.add("fullscreen-slider");
      fsBtn.innerHTML = iconMinimize();
      // The iframe has a fixed pixel height from SilverBullet; reset it so the
      // slider fills the fullscreen viewport instead of overflowing (scrollbar).
      if (globalThis.frameElement) {
        savedIframeStyle = globalThis.frameElement.getAttribute("style") || "";
        globalThis.frameElement.style.cssText =
          "width:100%!important;height:100%!important;border:0;position:fixed;inset:0;";
      }
      // Prevent the iframe's own document from scrolling.
      savedBodyStyle = document.body.getAttribute("style") || "";
      savedHtmlStyle = document.documentElement.getAttribute("style") || "";
      document.body.style.cssText += "margin:0;height:100%;overflow:hidden;";
      document.documentElement.style.cssText += "margin:0;height:100%;overflow:hidden;";
    };
    const exitFs = () => {
      isFs = false;
      root.classList.remove("ms-fullscreen");
      container.classList.remove("fullscreen-slider");
      fsBtn.innerHTML = iconMaximize();
      if (globalThis.frameElement) {
        globalThis.frameElement.setAttribute("style", savedIframeStyle);
      }
      document.body.setAttribute("style", savedBodyStyle);
      document.documentElement.setAttribute("style", savedHtmlStyle);
    };
    // The fullscreenchange event fires in the parent document (which owns the
    // iframe). Listen there if reachable; fall back to toggling on click.
    try {
      globalThis.parent.document.addEventListener("fullscreenchange", () => {
        if (globalThis.parent.document.fullscreenElement) enterFs();
        else exitFs();
      });
    } catch (e) {}
    fsBtn.onclick = () => {
      if (!isFs) {
        target.requestFullscreen().catch((err) =>
          console.error("Error enabling fullscreen:", err),
        );
        if (!globalThis.frameElement) enterFs();
      } else {
        (document.exitFullscreen || globalThis.parent?.document?.exitFullscreen)?.call(
          globalThis.parent?.document || document,
        );
        if (!globalThis.frameElement) exitFs();
      }
    };
    root.appendChild(fsBtn);

    const copyBtn = el("button", "copy-btn");
    copyBtn.innerHTML = iconCopy();
    copyBtn.title = "Copy markdown link";
    copyBtn.onclick = async () => {
      const s = slides[idx];
      const link = s.remote ? s.src : ("![[" + (s.rawPath || "") + "]]");
      try { await globalThis.syscall("editor.copyToClipboard", link); } catch (e) {}
    };
    root.appendChild(copyBtn);
  }

  let idx = 0;
  let direction = "next";

  function renderThumb(s, i) {
    let t;
    if (s.kind === "image" || s.kind === "youtube") {
      t = el("img", "thumbnail");
      // Defer the actual load: hold the URL in data-src and load lazily.
      t.setAttribute("data-src", s.thumb || s.src);
      t.loading = "lazy";
    } else {
      t = el("div", "thumbnail-placeholder");
      t.textContent = labelForKind(s.kind);
    }
    if (verticalThumbs) t.classList.add("vertical-thumb");
    t.onclick = () => { idx = i; update(); };
    return t;
  }

  // Lazy-load thumbnails: only fetch an image when it scrolls near the viewport,
  // so the first slide's media isn't competing with dozens of thumbnail fetches.
  let thumbObserver = null;
  function observeThumbs() {
    if (!thumbContainer || !("IntersectionObserver" in window)) return;
    if (!thumbObserver) {
      thumbObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const img = e.target;
            const ds = img.getAttribute("data-src");
            if (ds && !img.src) {
              img.src = ds;
              img.removeAttribute("data-src");
            }
            thumbObserver.unobserve(img);
          }
        }
      }, { root: thumbContainer, rootMargin: "200px" });
    }
    for (const t of thumbEls) {
      if (t.tagName === "IMG" && t.getAttribute("data-src")) thumbObserver.observe(t);
    }
  }

  if (thumbContainer) {
    for (let i = 0; i < slides.length; i++) {
      const t = renderThumb(slides[i], i);
      thumbContainer.appendChild(t);
      thumbEls.push(t);
    }
  }

  // Thumbnail collapse toggle button (matches the original plugin).
  let thumbToggleBtn = null;
  if (thumbContainer && opts.showThumbnailToggle) {
    thumbToggleBtn = el("button", "ms-thumbnail-toggle-btn");
    if (verticalThumbs) thumbToggleBtn.classList.add("ms-vertical");
    thumbToggleBtn.innerHTML = verticalThumbs ? iconChevronLeft() : iconChevronDown();
    if (opts.thumbnailsCollapsedByDefault) {
      thumbContainer.classList.add("ms-collapsed");
      thumbToggleBtn.innerHTML = verticalThumbs ? iconChevronRight() : iconChevronUp();
    }
    thumbToggleBtn.onclick = () => {
      const isCollapsed = thumbContainer.classList.toggle("ms-collapsed");
      thumbToggleBtn.innerHTML = verticalThumbs
        ? (isCollapsed ? iconChevronRight() : iconChevronLeft())
        : (isCollapsed ? iconChevronUp() : iconChevronDown());
      // Keep the host iframe height in sync as the thumbnail strip animates.
      // Update on rAF frames while the transition runs, and a final update on
      // transitionend — no setInterval polling.
      let framesLeft = 20; // ~330ms at 60fps, matching the 0.3s transition
      const onFrame = () => {
        requestHeight();
        if (framesLeft-- > 0) requestAnimationFrame(onFrame);
      };
      requestAnimationFrame(onFrame);
      const onEnd = () => {
        requestHeight();
        thumbContainer.removeEventListener("transitionend", onEnd);
      };
      thumbContainer.addEventListener("transitionend", onEnd);
    };
  }

  // Lay out: thumbnails first if top/left.
  const section = el("div", "ms-thumbnail-section " + (verticalThumbs ? "ms-vertical" : "ms-horizontal"));
  if (opts.thumbnailPosition === "top" || opts.thumbnailPosition === "left") {
    section.appendChild(thumbContainer);
    if (thumbToggleBtn) section.appendChild(thumbToggleBtn);
    root.appendChild(section);
    root.appendChild(content);
  } else if (thumbContainer) {
    root.appendChild(content);
    if (thumbToggleBtn) section.appendChild(thumbToggleBtn);
    section.appendChild(thumbContainer);
    root.appendChild(section);
  } else {
    root.appendChild(content);
  }
  // Now that thumbs are in the DOM, start lazy-loading the visible ones.
  observeThumbs();

  function setCaption(s) {
    captionWrap.innerHTML = "";
    if (!s.caption) return;
    const c = el("div", opts.captionMode === "below" ? "slider-caption" : "slider-caption-overlay");
    c.textContent = s.caption;
    if (opts.captionMode === "below") captionWrap.appendChild(c);
    else mediaWrap.appendChild(c);
  }

  function renderMedia(s) {
    mediaWrap.innerHTML = "";
    if (s.kind === "image") {
      const img = el("img", "slider-media");
      img.src = s.src;
      img.loading = "lazy";
      addZoomPan(img);
      mediaWrap.appendChild(img);
    } else if (s.kind === "video") {
      const v = el("video", "slider-media");
      v.src = s.src; v.controls = true;
      if (opts.autoplay) v.autoplay = true;
      mediaWrap.appendChild(v);
    } else if (s.kind === "audio") {
      const a = el("audio", "slider-media audio-media");
      a.src = s.src; a.controls = true;
      mediaWrap.appendChild(a);
    } else if (s.kind === "pdf") {
      const wrap = el("div", "pdf-container");
      const f = el("iframe", "slider-media pdf-media");
      f.src = s.src;
      wrap.appendChild(f);
      mediaWrap.appendChild(wrap);
    } else if (s.kind === "markdown") {
      mediaWrap.classList.add("markdown-content");
      loadMarkdown(s, mediaWrap);
    } else if (s.kind === "youtube") {
      const f = el("iframe", "slider-media");
      f.src = s.embed;
      f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      f.allowFullscreen = true;
      mediaWrap.appendChild(f);
    } else {
      const a = el("a", "slider-media");
      a.href = s.src; a.target = "_blank"; a.textContent = "Open file";
      mediaWrap.appendChild(a);
    }
  }

  async function loadMarkdown(s, into) {
    try {
      const text = await globalThis.syscall("space.readPage", s.rawPath);
      const md = await globalThis.syscall("markdown.markdownToHtml", text);
      into.innerHTML = md || escapeText(text);
    } catch (e) {
      into.textContent = "Failed to load " + (s.rawPath || s.src) + ": " + e;
    }
  }

  function escapeText(t) {
    return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function applyTransition(name, dir, isIn) {
    mediaWrap.classList.remove(
      ...allTransitionClasses()
    );
    let cls = "";
    if (name === "slide") cls = dir === "next" ? (isIn ? "transition-slide-next-in" : "transition-slide-next-out") : (isIn ? "transition-slide-prev-in" : "transition-slide-prev-out");
    else cls = "transition-" + (isIn ? name + "-in" : name + "-out");
    mediaWrap.classList.add(cls || "transition-fade-in");
  }

  function allTransitionClasses() {
    const out = [];
    for (const n of TRANSITIONS) out.push("transition-" + n + "-in", "transition-" + n + "-out");
    out.push("transition-slide-next-in","transition-slide-next-out","transition-slide-prev-in","transition-slide-prev-out");
    return out;
  }

  function update() {
    applyTransition(effect, direction, false);
    setTimeout(() => {
      renderMedia(slides[idx]);
      setCaption(slides[idx]);
      if (thumbEls.length) {
        thumbEls.forEach((t, i) => t.classList.toggle("active-thumbnail", i === idx));
        const active = thumbEls[idx];
        if (active && thumbContainer) {
          // Force-load the now-active thumbnail so its image shows immediately,
          // even if the IntersectionObserver hasn't picked it up yet.
          if (active.tagName === "IMG") {
            const ds = active.getAttribute("data-src");
            if (ds) { active.src = ds; active.removeAttribute("data-src"); }
          }
          if (verticalThumbs) thumbContainer.scrollTo({ top: active.offsetTop - thumbContainer.clientHeight/2 + active.clientHeight/2, behavior: "smooth" });
          else thumbContainer.scrollTo({ left: active.offsetLeft - thumbContainer.clientWidth/2 + active.clientWidth/2, behavior: "smooth" });
        }
      }
      void mediaWrap.offsetWidth;
      applyTransition(effect, direction, true);
      requestHeight();
    }, dur);
  }

  function goPrev() { direction = "prev"; idx = (idx - 1 + slides.length) % slides.length; update(); }
  function goNext() { direction = "next"; idx = (idx + 1) % slides.length; update(); }
  prevBtn.onclick = goPrev;
  nextBtn.onclick = goNext;

  // Wheel (horizontal swipe) navigation.
  content.addEventListener("wheel", (e) => {
    if (e.target && e.target.matches && e.target.matches("input,textarea")) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      if (e.deltaX > 30) { goNext(); e.preventDefault(); }
      else if (e.deltaX < -30) { goPrev(); e.preventDefault(); }
    }
  }, { passive: false });

  // Touch swipe.
  let touchX = 0;
  content.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; });
  content.addEventListener("touchend", (e) => {
    const dx = touchX - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 50) { if (dx > 0) goNext(); else goPrev(); }
  });

  // Keyboard (when the slider has focus).
  root.tabIndex = 0;
  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { goPrev(); e.preventDefault(); }
    else if (e.key === "ArrowRight") { goNext(); e.preventDefault(); }
  });

  // Autoplay / slideshow.
  let timer = null;
  function start() {
    if (opts.slideshowSpeed > 0) timer = setInterval(goNext, opts.slideshowSpeed * 1000);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  // Pause when the iframe is hidden (note switched away).
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  start();

  // Zoom & pan for images.
  function addZoomPan(img) {
    if (opts.enhancedView === false) return;
    let scale = 1, ox = 0, oy = 0, dragging = false, sx = 0, sy = 0;
    function reset() { scale = 1; ox = 0; oy = 0; apply(); }
    function apply() {
      img.style.transform = "translate(" + ox + "px," + oy + "px) scale(" + scale + ")";
      img.classList.toggle("zoomed", scale !== 1);
      img.classList.toggle("img-transformed", true);
    }
    img.classList.add("can-zoom");
    img.addEventListener("click", (e) => {
      if (scale === 1) { scale = 2; ox = (img.clientWidth/2 - e.offsetX); oy = (img.clientHeight/2 - e.offsetY); }
      else reset();
      apply();
    });
    img.addEventListener("mousedown", (e) => { if (scale !== 1) { dragging = true; sx = e.clientX - ox; sy = e.clientY - oy; img.classList.add("dragging"); } });
    window.addEventListener("mousemove", (e) => { if (dragging) { ox = e.clientX - sx; oy = e.clientY - sy; apply(); } });
    window.addEventListener("mouseup", () => { dragging = false; img.classList.remove("dragging"); });
    img.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.2 : 1/1.2;
      scale = Math.min(5, Math.max(0.5, scale * delta));
      if (scale === 1) reset();
      apply();
    }, { passive: false });
  }

  function labelForKind(k) {
    return { image:"IMG", video:"VID", audio:"AUD", pdf:"PDF", markdown:"MD", youtube:"YT", unknown:"FILE" }[k] || "FILE";
  }
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function requestHeight() {
    if (!globalThis.parent) return;
    // Measure the wrapper itself — it reflects the real laid-out height
    // (including or excluding the thumbnail strip depending on its state),
    // so the iframe both grows and shrinks correctly. Include the toggle
    // button's height (it sits in the thumbnail section) plus a small buffer
    // for margins/padding so content isn't clipped.
    const sectionEls = root.querySelectorAll(".ms-thumbnail-section");
    let extra = 0;
    sectionEls.forEach((s) => { extra += s.offsetHeight; });
    const h = Math.max(
      root.scrollHeight,
      root.offsetHeight,
      document.body.scrollHeight,
      document.body.offsetHeight,
    ) + 18;
    globalThis.parent.postMessage({ type: "setHeight", height: h }, "*");
  }

  // Initial render + height polling.
  update();
  let checks = 0;
  (function h() { requestHeight(); if (checks++ < 25) setTimeout(h, 100); })();
}

function iconChevronLeft() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>'; }
function iconChevronRight() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'; }
function iconChevronUp() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>'; }
function iconChevronDown() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>'; }
function iconMaximize() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>'; }
function iconMinimize() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path></svg>'; }
function iconCopy() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'; }
`;