import type { SVGProps } from "react";

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.25,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
  "aria-hidden": true,
};

type P = SVGProps<SVGSVGElement>;

export const PlayIcon = (p: P) => (
  <svg {...base} {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></svg>
);
export const StopIcon = (p: P) => (
  <svg {...base} {...p}><rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none" /></svg>
);
export const PauseIcon = (p: P) => (
  <svg {...base} {...p}><path d="M8 5v14M16 5v14" strokeWidth={5} /></svg>
);
export const RewindIcon = (p: P) => (
  <svg {...base} {...p}><path d="M5 5v14" /><path d="M19 5.5v13L9 12z" fill="currentColor" stroke="none" /></svg>
);
export const RecordIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none" /></svg>
);
export const MicIcon = (p: P) => (
  <svg {...base} {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
);
export const BackIcon = (p: P) => (
  <svg {...base} {...p}><path d="M20 12H5M11 6l-6 6 6 6" /></svg>
);
export const DownloadIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 3v12M6.5 10l5.5 5.5 5.5-5.5M4 20h16" /></svg>
);
export const UndoIcon = (p: P) => (
  <svg {...base} {...p}><path d="M9 6 4 11l5 5" /><path d="M4 11h10a6 6 0 0 1 0 12h-2" /></svg>
);
export const RedoIcon = (p: P) => (
  <svg {...base} {...p}><path d="m15 6 5 5-5 5" /><path d="M20 11H10a6 6 0 0 0 0 12h2" /></svg>
);
export const SaveIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 4h13l3 3v13H4z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></svg>
);
export const OpenIcon = (p: P) => (
  <svg {...base} {...p}><path d="M3 6h7l2 2h9v11H3z" /></svg>
);
