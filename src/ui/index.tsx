import { render } from "preact";
import { Slider } from "./Slider.tsx";

// These are injected as hoisted `var` declarations before this bundle by the
// plug's render function (see media_slider.ts). Using `var` (not const) means
// they are visible inside this IIFE via closure.
declare const __SLIDES: SlideDescriptor[];
declare const __OPTIONS: SliderOptions;

const root = document.querySelector(".media-slider-wrapper") as HTMLElement | null;
if (!root) {
  console.error("[media-slider] wrapper element not found");
} else {
  try {
    console.log("[media-slider] booting", __SLIDES.length, "slides");
    render(<Slider slides={__SLIDES} options={__OPTIONS} root={root} />, root);
  } catch (e) {
    console.error("[media-slider] boot failed:", e);
    root.innerHTML =
      '<div class="ms-error">media-slider failed to render: ' +
      String((e as Error)?.message ?? e) +
      "</div>";
  }
}

export interface SlideDescriptor {
  kind: "image" | "video" | "audio" | "pdf" | "markdown" | "youtube" | "unknown";
  src: string;
  rawPath?: string;
  caption: string | null;
  remote: boolean;
  thumb: string | null;
  embed: string | null;
}

export interface SliderOptions {
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