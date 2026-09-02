import type { ComponentChild } from "preact";

const SvgIcon = ({ children }: { children: ComponentChild }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {children}
  </svg>
);

export const IconChevronLeft = () => <SvgIcon><polyline points="15 18 9 12 15 6"></polyline></SvgIcon>;
export const IconChevronRight = () => <SvgIcon><polyline points="9 18 15 12 9 6"></polyline></SvgIcon>;
export const IconChevronUp = () => <SvgIcon><polyline points="18 15 12 9 6 15"></polyline></SvgIcon>;
export const IconChevronDown = () => <SvgIcon><polyline points="6 9 12 15 18 9"></polyline></SvgIcon>;
export const IconMaximize = () => (
  <SvgIcon>
    <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
    <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
    <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
    <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
  </SvgIcon>
);
export const IconMinimize = () => (
  <SvgIcon>
    <path d="M8 3v3a2 2 0 0 1-2 2H3"></path>
    <path d="M21 8h-3a2 2 0 0 1-2-2V3"></path>
    <path d="M3 16h3a2 2 0 0 1 2 2v3"></path>
    <path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>
  </SvgIcon>
);
export const IconCopy = () => (
  <SvgIcon>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </SvgIcon>
);
export const IconZoomIn = () => (
  <SvgIcon>
    <circle cx="11" cy="11" r="7"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    <line x1="11" y1="8" x2="11" y2="14"></line>
    <line x1="8" y1="11" x2="14" y2="11"></line>
  </SvgIcon>
);
export const IconZoomOut = () => (
  <SvgIcon>
    <circle cx="11" cy="11" r="7"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    <line x1="8" y1="11" x2="14" y2="11"></line>
  </SvgIcon>
);
export const IconReset = () => (
  <SvgIcon>
    <polyline points="1 4 1 10 7 10"></polyline>
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
  </SvgIcon>
);