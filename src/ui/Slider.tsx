import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChild } from "preact";
import type { SlideDescriptor, SliderOptions } from "./index";
import cx from "./classnames";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronDown,
  IconMaximize,
  IconMinimize,
  IconCopy,
  IconZoomIn,
  IconZoomOut,
  IconReset,
} from "./icons";

const TRANSITIONS = [
  "fade", "slide", "zoom", "slide-up", "slide-down",
  "flip", "flip-vertical", "rotate", "blur", "squeeze",
];

const ALL_TRANSITION_CLASSES = TRANSITIONS.flatMap((n) => [
  `transition-${n}-in`,
  `transition-${n}-out`,
]).concat([
  "transition-slide-next-in", "transition-slide-next-out",
  "transition-slide-prev-in", "transition-slide-prev-out",
]);

const KIND_LABELS: Record<string, string> = {
  image: "IMG", video: "VID", audio: "AUD", pdf: "PDF",
  markdown: "MD", youtube: "YT", unknown: "FILE",
};

interface Props {
  slides: SlideDescriptor[];
  options: SliderOptions;
  root: HTMLElement;
}

export function Slider({ slides, options, root }: Props) {
  const effect = TRANSITIONS.includes(options.transitionEffect)
    ? options.transitionEffect
    : "fade";
  const dur = Math.max(0, Number(options.transitionDuration) || 300);
  const verticalThumbs =
    options.thumbnailPosition === "left" || options.thumbnailPosition === "right";

  const [idx, setIdx] = useState(0);
  const directionRef = useRef<"next" | "prev">("next");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [thumbsCollapsed, setThumbsCollapsed] = useState(
    options.thumbnailsCollapsedByDefault,
  );
  const [mdHtml, setMdHtml] = useState<string>("");
  const [displayedIdx, setDisplayedIdx] = useState(0);
  const isFirstRender = useRef(true);
  const isFirstDisplay = useRef(true);

  const mediaWrapRef = useRef<HTMLDivElement>(null);
  const thumbContainerRef = useRef<HTMLDivElement>(null);
  const thumbElsRef = useRef<HTMLElement[]>([]);
  const savedFsState = useRef({ iframe: "", body: "", html: "" });
  const mediaImgRef = useRef<HTMLImageElement>(null);
  const sliderContainerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const zoom = useZoomPan(mediaImgRef, displayedIdx);

  const wrapperStyle = {
    "--slider-width": options.width,
    "--slider-height": options.height,
    "--transition-duration": dur + "ms",
  } as preact.JSX.CSSProperties;
  const wrapperClass = cx("media-slider-wrapper", verticalThumbs ? "flex-row" : "flex-column");

  const requestHeight = useCallback(() => {
    if (!globalThis.parent) return;
    const el = wrapperRef.current ?? root;
    const h = Math.max(
      el.scrollHeight,
      el.offsetHeight,
      document.body.scrollHeight,
      document.body.offsetHeight,
    ) + 18;
    globalThis.parent.postMessage({ type: "setHeight", height: h }, "*");
  }, [root]);

  const goPrev = useCallback(() => {
    directionRef.current = "prev";
    setIdx((i) => (i - 1 + slides.length) % slides.length);
  }, [slides.length]);

  const goNext = useCallback(() => {
    directionRef.current = "next";
    setIdx((i) => (i + 1) % slides.length);
  }, [slides.length]);

  const touchXRef = useRef(0);
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") { goPrev(); e.preventDefault(); }
    else if (e.key === "ArrowRight") { goNext(); e.preventDefault(); }
  }, [goPrev, goNext]);
  const onTouchStart = useCallback((e: TouchEvent) => {
    touchXRef.current = e.touches[0].clientX;
  }, []);
  const onTouchEnd = useCallback((e: TouchEvent) => {
    const dx = touchXRef.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 50) { if (dx > 0) goNext(); else goPrev(); }
  }, [goPrev, goNext]);

  // Apply transition classes to the media wrapper. Uses directionRef so the
  // callback identity is stable and doesn't re-trigger effects.
  const applyTransition = useCallback(
    (isIn: boolean) => {
      const mw = mediaWrapRef.current;
      if (!mw) return;
      mw.classList.remove(...ALL_TRANSITION_CLASSES);
      let cls: string;
      if (effect === "slide") {
        const d = directionRef.current === "next" ? "next" : "prev";
        cls = `transition-slide-${d}-${isIn ? "in" : "out"}`;
      } else {
        cls = `transition-${effect}-${isIn ? "in" : "out"}`;
      }
      mw.classList.add(cls || "transition-fade-in");
    },
    [effect],
  );

  // Force-load the active thumbnail image.
  useEffect(() => {
    if (!options.carouselShowThumbnails) return;
    const active = thumbElsRef.current[idx];
    if (active && active.tagName === "IMG") {
      const ds = active.getAttribute("data-src");
      if (ds) {
        active.setAttribute("src", ds);
        active.removeAttribute("data-src");
      }
    }
    // Scroll active thumbnail into view.
    const container = thumbContainerRef.current;
    if (active && container) {
      if (verticalThumbs) {
        container.scrollTo({
          top: active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2,
          behavior: "smooth",
        });
      } else {
        container.scrollTo({
          left: active.offsetLeft - container.clientWidth / 2 + active.clientWidth / 2,
          behavior: "smooth",
        });
      }
    }
  }, [idx, options.carouselShowThumbnails, verticalThumbs]);

  // Load markdown content when the displayed slide is markdown.
  useEffect(() => {
    const s = slides[displayedIdx];
    if (s.kind !== "markdown") {
      setMdHtml("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const text = await globalThis.syscall("space.readPage", s.rawPath);
        const html = await globalThis.syscall("markdown.markdownToHtml", text);
        if (!cancelled) setMdHtml(html || "");
      } catch (e) {
        if (!cancelled)
          setMdHtml(`<p>Failed to load ${s.rawPath || s.src}: ${e}</p>`);
      }
    })();
    return () => { cancelled = true; };
  }, [displayedIdx, slides]);

  // Transition: mirror the old runtime's synchronous sequence exactly.
  // On idx change: (1) apply out-class to media wrapper, (2) after dur ms
  // swap displayedIdx (Preact re-renders new content), (3) on the next paint
  // force reflow + apply in-class. All class manipulation is direct DOM, not
  // state-driven, so the browser paints the intermediate opacity:0 frame.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Step 1: out-transition on current (old) content.
    applyTransition(false);
    const t = setTimeout(() => {
      // Step 2: swap content. Preact will re-render with new displayedIdx.
      setDisplayedIdx(idx);
    }, dur);
    return () => clearTimeout(t);
  }, [idx, applyTransition, dur]);

  // Step 3: after the content swap commits, force reflow + apply in-class.
  // Runs after paint; force a reflow so the browser registers the
  // out-class's opacity:0 state, then apply the in-class.
  useEffect(() => {
    if (isFirstDisplay.current) {
      isFirstDisplay.current = false;
      return;
    }
    if (displayedIdx !== idx) return;
    const mw = mediaWrapRef.current;
    if (!mw) return;
    // The out-class is still on the wrapper (opacity:0). Force a reflow so
    // the browser registers the current state, then apply the in-class.
    void mw.offsetWidth;
    applyTransition(true);
    requestHeight();
  }, [displayedIdx, idx, applyTransition, requestHeight]);

  // Lazy-load thumbnails via IntersectionObserver.
  useEffect(() => {
    if (!options.carouselShowThumbnails || !("IntersectionObserver" in window)) return;
    const container = thumbContainerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const img = e.target as HTMLImageElement;
            const ds = img.getAttribute("data-src");
            if (ds && !img.src) {
              img.src = ds;
              img.removeAttribute("data-src");
            }
            observer.unobserve(img);
          }
        }
      },
      { root: container, rootMargin: "200px" },
    );
    for (const t of thumbElsRef.current) {
      if (t.tagName === "IMG" && t.getAttribute("data-src")) observer.observe(t);
    }
    return () => observer.disconnect();
  }, [options.carouselShowThumbnails]);

  // Keyboard, wheel, and touch navigation are wired via Preact events on the
  // .slider-content element (see JSX below) — no manual addEventListener.

  // Autoplay / slideshow.
  useEffect(() => {
    if (options.slideshowSpeed <= 0) return;
    const id = setInterval(goNext, options.slideshowSpeed * 1000);
    const onVis = () => { if (document.hidden) clearInterval(id); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [options.slideshowSpeed, goNext]);

  // Height polling on thumbnail toggle — needed in BOTH directions so the
  // iframe grows on expand and shrinks on collapse.
  useEffect(() => {
    let framesLeft = 20;
    let rafId = 0;
    const onFrame = () => {
      requestHeight();
      if (framesLeft-- > 0) rafId = requestAnimationFrame(onFrame);
    };
    rafId = requestAnimationFrame(onFrame);
    return () => cancelAnimationFrame(rafId);
  }, [thumbsCollapsed, requestHeight]);

  // Fullscreen.
  const enterFs = useCallback(() => {
    setIsFullscreen(true);
    (wrapperRef.current ?? root).classList.add("ms-fullscreen");
    if (globalThis.frameElement) {
      savedFsState.current.iframe = globalThis.frameElement.getAttribute("style") || "";
      globalThis.frameElement.style.cssText =
        "width:100%!important;height:100%!important;border:0;position:fixed;inset:0;";
    }
    savedFsState.current.body = document.body.getAttribute("style") || "";
    savedFsState.current.html = document.documentElement.getAttribute("style") || "";
    document.body.style.cssText += "margin:0;height:100%;overflow:hidden;";
    document.documentElement.style.cssText += "margin:0;height:100%;overflow:hidden;";
  }, [root]);

  const exitFs = useCallback(() => {
    setIsFullscreen(false);
    (wrapperRef.current ?? root).classList.remove("ms-fullscreen");
    if (globalThis.frameElement) {
      globalThis.frameElement.setAttribute("style", savedFsState.current.iframe);
    }
    document.body.setAttribute("style", savedFsState.current.body);
    document.documentElement.setAttribute("style", savedFsState.current.html);
  }, [root]);

  useEffect(() => {
    try {
      globalThis.parent.document.addEventListener("fullscreenchange", () => {
        if (globalThis.parent.document.fullscreenElement) enterFs();
        else exitFs();
      });
    } catch { /* ignore */ }
  }, [enterFs, exitFs]);

  const toggleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      const target = globalThis.frameElement || root;
      target.requestFullscreen?.().catch((err: Error) =>
        console.error("Error enabling fullscreen:", err),
      );
      if (!globalThis.frameElement) enterFs();
    } else {
      (document.exitFullscreen || globalThis.parent?.document?.exitFullscreen)?.call(
        globalThis.parent?.document || document,
      );
      if (!globalThis.frameElement) exitFs();
    }
  }, [isFullscreen, root, enterFs, exitFs]);

  const copyLink = useCallback(async () => {
    const s = slides[displayedIdx];
    const link = s.remote ? s.src : `![[${s.rawPath || ""}]]`;
    try { await globalThis.syscall("editor.copyToClipboard", link); } catch { /* ignore */ }
  }, [slides, displayedIdx]);

  const toggleThumbs = useCallback(() => {
    setThumbsCollapsed((c) => !c);
  }, []);

  // Height polling on mount.
  useEffect(() => {
    requestHeight();
    let checks = 0;
    const id = setInterval(() => {
      requestHeight();
      if (++checks > 25) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [requestHeight]);

  const s = slides[displayedIdx];

  const setThumbRef = (i: number) => (el: Element | null) => {
    if (el) thumbElsRef.current[i] = el as any;
  };

  const sectionClass = cx("ms-thumbnail-section", verticalThumbs ? "ms-vertical" : "ms-horizontal");
  const thumbSection = options.carouselShowThumbnails && (
    <div class={sectionClass}>
      {options.showThumbnailToggle && (
        <button
          class={cx("ms-thumbnail-toggle-btn", { "ms-vertical": verticalThumbs })}
          title="Toggle thumbnails"
          onClick={toggleThumbs}
        >
          {verticalThumbs
            ? (thumbsCollapsed ? <IconChevronRight /> : <IconChevronLeft />)
            : (thumbsCollapsed ? <IconChevronUp /> : <IconChevronDown />)}
        </button>
      )}
      <div
        ref={thumbContainerRef as any}
        class={cx("thumbnail-container", verticalThumbs ? "vertical" : "horizontal", { "ms-collapsed": thumbsCollapsed })}
      >
        {slides.map((slide, i) => {
          const isImg = slide.kind === "image" || slide.kind === "youtube";
          return isImg ? (
            <img
              class={cx("thumbnail", { "vertical-thumb": verticalThumbs })}
              data-src={slide.thumb || slide.src}
              loading="lazy"
              ref={setThumbRef(i)}
              onClick={() => setIdx(i)}
            />
          ) : (
            <div
              class={cx("thumbnail-placeholder", { "vertical-thumb": verticalThumbs })}
              ref={setThumbRef(i)}
              onClick={() => setIdx(i)}
            >
              {KIND_LABELS[slide.kind] ?? "FILE"}
            </div>
          );
        })}
      </div>
    </div>
  );

  const mediaContent = renderMedia(s, mdHtml, options, mediaImgRef, zoom.handlers);
  const isZoomable = s.kind === "image";

  const onZoomInBtn = useCallback(() => {
    const r = sliderContainerRef.current?.getBoundingClientRect();
    if (r) zoom.zoomAt(0.5, r.left + r.width / 2, r.top + r.height / 2);
  }, [zoom]);
  const onZoomOutBtn = useCallback(() => {
    const r = sliderContainerRef.current?.getBoundingClientRect();
    if (r) zoom.zoomAt(-0.5, r.left + r.width / 2, r.top + r.height / 2);
  }, [zoom]);

  const thumbsFirst = options.thumbnailPosition === "top" || options.thumbnailPosition === "left";

  return (
    <div ref={wrapperRef} class={wrapperClass} style={wrapperStyle}>
      {thumbsFirst && thumbSection}
      <div
        class="slider-content"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          ref={sliderContainerRef}
          class={cx("slider-container", { "fullscreen-slider": isFullscreen })}
          onWheel={isZoomable ? zoom.handlers.onWheel : undefined}
        >
          <div ref={mediaWrapRef} class="media-wrapper">
            <div key={displayedIdx} class="media-inner">
              {mediaContent}
            </div>
          </div>
          {options.enhancedView && isZoomable && (
            <ZoomControls
              state={zoom.state}
              onZoomIn={onZoomInBtn}
              onZoomOut={onZoomOutBtn}
              onReset={zoom.reset}
            />
          )}
          {zoom.dragging && (
            <div
              class="zoom-drag-overlay"
              onMouseMove={zoom.onDragMove}
              onMouseUp={zoom.onDragEnd}
            />
          )}
        </div>
        <div class="slider-caption-container">
          {s.caption && options.captionMode === "below" && (
            <div class="slider-caption">{s.caption}</div>
          )}
        </div>
        <button
          class="slider-btn prev"
          title="Previous"
          onClick={goPrev}
        >
          <IconChevronLeft />
        </button>
        <button
          class="slider-btn next"
          title="Next"
          onClick={goNext}
        >
          <IconChevronRight />
        </button>
      </div>
      {!thumbsFirst && thumbSection}
      {options.enhancedView && (
        <>
          <button
            class="fullscreen-btn"
            title="Fullscreen"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <IconMinimize /> : <IconMaximize />}
          </button>
          <button
            class="copy-btn"
            title="Copy markdown link"
            onClick={copyLink}
          >
            <IconCopy />
          </button>
        </>
      )}
    </div>
  );
}

function renderMedia(
  s: SlideDescriptor,
  mdHtml: string,
  opts: SliderOptions,
  imgRef: preact.RefObject<HTMLImageElement>,
  handlers?: ZoomHandlers,
): ComponentChild {
  if (!s) return null;
  switch (s.kind) {
    case "image":
      return (
        <img
          class="slider-media can-zoom"
          src={s.src}
          loading="lazy"
          ref={imgRef as any}
          onClick={handlers?.onClick}
          onMouseDown={handlers?.onMouseDown}
        />
      );
    case "video":
      return (
        <video class="slider-media" src={s.src} controls autoplay={opts.autoplay} />
      );
    case "audio":
      return <audio class="slider-media audio-media" src={s.src} controls />;
    case "pdf":
      return (
        <div class="pdf-container">
          <iframe class="slider-media pdf-media" src={s.src} />
        </div>
      );
    case "markdown":
      return (
        <div
          class="markdown-content"
          dangerouslySetInnerHTML={{ __html: mdHtml || "Loading…" }}
        />
      );
    case "youtube":
      return (
        <iframe
          class="slider-media"
          src={s.embed || ""}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        />
      );
    default:
      return <a class="slider-media" href={s.src} target="_blank">Open file</a>;
  }
}

interface ZoomState {
  scale: number;
  tx: number;
  ty: number;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;

type ZoomHandlers = {
  onClick: (e: MouseEvent) => void;
  onMouseDown: (e: MouseEvent) => void;
  onWheel: (e: WheelEvent) => void;
};

// Zoom & pan state + handlers for an image. Returns Preact event handlers to
// attach to the <img> (onClick toggles zoom-to-point, onMouseDown starts a
// drag, onWheel zooms with ctrl/cmd). Document mousemove/mouseup are tracked
// only while dragging. transform-origin is center.
function useZoomPan(targetRef: preact.RefObject<HTMLImageElement>, slideKey: number) {
  const [state, setState] = useState<ZoomState>({ scale: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ startX: 0, startY: 0 });

  const applyTransform = useCallback((s: ZoomState) => {
    const img = targetRef.current;
    if (!img) return;
    img.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`;
    img.classList.add("img-transformed");
    img.classList.toggle("zoomed", s.scale > 1);
  }, [targetRef]);

  // Reset whenever the displayed slide changes.
  useEffect(() => {
    setState({ scale: 1, tx: 0, ty: 0 });
  }, [slideKey]);

  useEffect(() => {
    applyTransform(state);
  }, [state, applyTransform]);

  const zoomAt = useCallback((delta: number, cx: number, cy: number) => {
    const img = targetRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const imgCenterX = rect.left + rect.width / 2;
    const imgCenterY = rect.top + rect.height / 2;
    const offsetX = cx - imgCenterX;
    const offsetY = cy - imgCenterY;
    setState((prev) => {
      const oldScale = prev.scale;
      const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.scale + delta));
      if (scale === oldScale) return prev;
      let tx = prev.tx;
      let ty = prev.ty;
      if (delta > 0) {
        tx -= offsetX * (scale / oldScale - 1);
        ty -= offsetY * (scale / oldScale - 1);
      } else {
        tx = prev.tx * (scale / oldScale);
        ty = prev.ty * (scale / oldScale);
      }
      return { scale, tx, ty };
    });
  }, [targetRef]);

  const onClick = useCallback((e: MouseEvent) => {
    if (dragging) return; // ignore clicks ending a drag
    e.preventDefault();
    e.stopPropagation();
    const img = targetRef.current;
    if (!img) return;
    setState((prev) => {
      if (prev.scale > 1) return { scale: 1, tx: 0, ty: 0 };
      const rect = img.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / rect.width;
      const cy = (e.clientY - rect.top) / rect.height;
      const scale = 1.25;
      return {
        scale,
        tx: -(cx - 0.5) * rect.width * (scale - 1),
        ty: -(cy - 0.5) * rect.height * (scale - 1),
      };
    });
  }, [targetRef, dragging]);

  const onMouseDown = useCallback((e: MouseEvent) => {
    setState((prev) => {
      if (prev.scale <= 1) return prev;
      dragStartRef.current = { startX: e.clientX - prev.tx, startY: e.clientY - prev.ty };
      setDragging(true);
      e.preventDefault();
      e.stopPropagation();
      return prev;
    });
  }, []);

  const onDragMove = useCallback((e: MouseEvent) => {
    e.preventDefault();
    setState((prev) => ({
      ...prev,
      tx: e.clientX - dragStartRef.current.startX,
      ty: e.clientY - dragStartRef.current.startY,
    }));
  }, []);

  const onDragEnd = useCallback((e: MouseEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const onWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    zoomAt(delta, e.clientX, e.clientY);
  }, [zoomAt]);

  const reset = useCallback(() => setState({ scale: 1, tx: 0, ty: 0 }), []);

  return {
    state,
    handlers: { onClick, onMouseDown, onWheel } as ZoomHandlers,
    reset,
    zoomAt,
    dragging,
    onDragMove,
    onDragEnd,
  };
}

// Zoom +/-/reset button cluster.
function ZoomControls({ state, onZoomIn, onZoomOut, onReset }: {
  state: ZoomState;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const disabled = state.scale <= ZOOM_MIN && state.tx === 0 && state.ty === 0;
  return (
    <div class="zoom-controls" style={{ opacity: state.scale > 1 ? 1 : 0.5 }}>
      <button class="zoom-btn" title="Zoom in" onClick={onZoomIn}><IconZoomIn /></button>
      <button class="zoom-btn" title="Zoom out" onClick={onZoomOut} disabled={state.scale <= ZOOM_MIN}><IconZoomOut /></button>
      <button class="zoom-btn" title="Reset zoom" onClick={onReset} disabled={disabled}><IconReset /></button>
    </div>
  );
}