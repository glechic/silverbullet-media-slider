import { useCallback, useEffect, useRef, useState } from "preact/hooks";

// Fullscreen for a slider running inside a sandboxed iframe. When inside an
// iframe, requestFullscreen targets frameElement and we also pin body/html
// styles so the iframe fills the viewport. Listens for the parent document's
// fullscreenchange to sync state if the user exits via Esc.
// Fullscreen for a slider running inside a sandboxed iframe. The class is
// toggled on `rootEl` (the host) so the fullscreen CSS (width/height 100%)
// applies to the element that has the height context. requestFullscreen
// targets the iframe (frameElement) when present, else rootEl. Listens for
// the parent document's fullscreenchange to sync state on Esc.
export function useFullscreen(rootEl: HTMLElement) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const saved = useRef({ iframe: "", body: "", html: "" });

  const enter = useCallback(() => {
    setIsFullscreen(true);
    rootEl.classList.add("ms-fullscreen");
    if (globalThis.frameElement) {
      saved.current.iframe = globalThis.frameElement.getAttribute("style") || "";
      globalThis.frameElement.style.cssText =
        "width:100%!important;height:100%!important;border:0;position:fixed;inset:0;";
    }
    saved.current.body = document.body.getAttribute("style") || "";
    saved.current.html = document.documentElement.getAttribute("style") || "";
    document.body.style.cssText += "margin:0;height:100%;overflow:hidden;";
    document.documentElement.style.cssText += "margin:0;height:100%;overflow:hidden;";
  }, [rootEl]);

  const exit = useCallback(() => {
    setIsFullscreen(false);
    rootEl.classList.remove("ms-fullscreen");
    if (globalThis.frameElement) {
      globalThis.frameElement.setAttribute("style", saved.current.iframe);
    }
    document.body.setAttribute("style", saved.current.body);
    document.documentElement.setAttribute("style", saved.current.html);
  }, [rootEl]);

  useEffect(() => {
    try {
      globalThis.parent.document.addEventListener("fullscreenchange", () => {
        if (globalThis.parent.document.fullscreenElement) enter();
        else exit();
      });
    } catch { /* ignore */ }
  }, [enter, exit]);

  const toggle = useCallback(() => {
    if (!isFullscreen) {
      const target = globalThis.frameElement || rootEl;
      target.requestFullscreen?.().catch((err: Error) =>
        console.error("Error enabling fullscreen:", err),
      );
      if (!globalThis.frameElement) enter();
    } else {
      (document.exitFullscreen || globalThis.parent?.document?.exitFullscreen)?.call(
        globalThis.parent?.document || document,
      );
      if (!globalThis.frameElement) exit();
    }
  }, [isFullscreen, rootEl, enter, exit]);

  return { isFullscreen, toggle };
}