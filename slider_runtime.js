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