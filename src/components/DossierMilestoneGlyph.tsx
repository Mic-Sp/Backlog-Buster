import type { Achievement } from "@/lib/achievements";

// Vector counterparts of the HUD glyphs stay legible in PNGs on every system.
export default function DossierMilestoneGlyph({ achievementKey, color = "#fcee0a" }: { achievementKey: Achievement["key"]; color?: string }) {
  let shape;
  switch (achievementKey) {
    case "first-blood":
      shape = <><path d="m4 3 14 14M3 6l3-3m10 12 5 5m-5 0 4-4M20 3 6 17m12-14 3 3M8 15l-5 5m0-4 4 4" /></>;
      break;
    case "street-kid":
      shape = <path d="M14 2 4 13h7l-1 9 10-12h-7Z" />;
      break;
    case "night-city-legend":
      shape = <><path d="m3 6 5 4 4-7 4 7 5-4-2 13H5ZM5 16h14" /><circle cx="3" cy="5" r="1" /><circle cx="12" cy="2" r="1" /><circle cx="21" cy="5" r="1" /></>;
      break;
    case "time-dilation":
      shape = <><circle cx="12" cy="14" r="8" /><path d="M9 2h6m-3 0v4m6 1 2-2m-8 5v5l3 2" /></>;
      break;
    case "chronos-master":
      shape = <><path d="M5 2h14M5 22h14M7 2v4l10 12v4M17 2v4L7 18v4M8 7h8m-8 12h8" /></>;
      break;
    case "hardcore-netrunner":
      shape = <><path d="M5 15a9 9 0 1 1 14 0v4H5ZM8 19v3h8v-3m-5-4 1-2 1 2" /><circle cx="8" cy="11" r="2" /><circle cx="16" cy="11" r="2" /><path d="M10 19v3m4-3v3" /></>;
      break;
    case "multi-deck":
      shape = <><path d="M6 6h12c3 0 5 11 3 12-2 1-5-3-5-3H8s-3 4-5 3C1 17 3 6 6 6Z" /><path d="M7 9v5m-2.5-2.5h5M16 10h.1m2 3h.1" /></>;
      break;
    case "genre-specialist":
      shape = <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /><path d="m13 11 9-9m-4 0h4v4" /></>;
      break;
    case "cyberware-critic":
      shape = <path d="m12 2 3 6.5 7 1-5 5 1.2 7L12 18l-6.2 3.5 1.2-7-5-5 7-1Z" />;
      break;
    case "second-heart":
      shape = <><path d="M12 21 3 12C-2 5 7-1 12 6 17-1 26 5 21 12Z" /><path d="m13 7-5 6h5l-2 5 6-7h-5Z" /></>;
      break;
    case "saga-completionist":
      shape = <><path d="m10 14-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m1 5 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0m-3-3 8-8" /></>;
      break;
  }
  return <g transform="translate(5 5) scale(.92)" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shape}</g>;
}
