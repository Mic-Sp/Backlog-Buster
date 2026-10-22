import type { SVGProps } from "react";

/** All accents are inert, absolutely positioned, and hidden outside Fantasy mode. */
export function FantasyCorners() {
  return <span className="fantasy-decoration fantasy-corners" aria-hidden="true">
    {["nw", "ne", "se", "sw"].map(corner => <svg key={corner} className={`fantasy-corner fantasy-corner-${corner}`} viewBox="0 0 64 64" fill="none" focusable="false">
      <path d="M5 56V5H56M11 43V11H43" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 32C29 34 37 16 27 13C17 10 16 29 30 29C43 29 44 9 56 9M9 56C9 44 29 43 29 30" stroke="currentColor" strokeWidth="1.4" />
      <path d="M14 14L21 16L16 21Z M39 9L43 5L47 9L43 13Z M9 39L13 43L9 47L5 43Z" fill="currentColor" />
    </svg>)}
  </span>;
}

export function HeroCrest(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false" {...props}>
    <circle cx="50" cy="50" r="47" fill="#775a26" stroke="#f4d990" strokeWidth="3" />
    <circle cx="50" cy="50" r="41" fill="#224c41" stroke="#bfa15a" strokeWidth="2" />
    <path d="M50 17L74 29V54C74 70 59 80 50 85C41 80 26 70 26 54V29Z" fill="#35694e" stroke="#e1c579" strokeWidth="2" />
    <path d="M50 27L60 44H40ZM39 46L49 63H29ZM61 46L71 63H51Z" fill="#efd58a" />
    <path d="M24 43L13 35L19 55L32 64M76 43L87 35L81 55L68 64M37 73L50 80L63 73" stroke="#d7b65f" strokeWidth="3" strokeLinecap="round" />
    <path d="M18 22L23 18M77 18L82 22M18 78L23 82M77 82L82 78" stroke="#ffe3a0" strokeWidth="2" />
  </svg>;
}

export function NaviFairy() {
  return <svg className="fantasy-decoration fantasy-navi" viewBox="0 0 80 64" fill="none" aria-hidden="true" focusable="false">
    <g className="fantasy-navi-wings">
      <path className="fantasy-navi-wing-left" d="M36 32C10 29 3 10 10 6C21 1 35 15 39 28C21 7 12 38 35 38Z" fill="#d4f4ff" fillOpacity=".85" stroke="#a8dff1" />
      <path className="fantasy-navi-wing-right" d="M44 32C70 29 77 10 70 6C59 1 45 15 41 28C59 7 68 38 45 38Z" fill="#d4f4ff" fillOpacity=".85" stroke="#a8dff1" />
    </g>
    <circle cx="40" cy="34" r="13" fill="#7dd9f3" fillOpacity=".35" />
    <circle cx="40" cy="34" r="8" fill="#d7f8ff" stroke="#a0e7ff" strokeWidth="2" />
    <path d="M15 47V55M11 51H19M62 44V50M59 47H65" stroke="#b8efff" strokeLinecap="round" />
  </svg>;
}

export function CButtonBadge({ direction }: { direction: string }) {
  return <span className="fantasy-c-button fantasy-decoration" aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none" focusable="false"><circle cx="24" cy="24" r="22" fill="#b88927" stroke="#ffe5a0" strokeWidth="2" /><circle cx="23" cy="22" r="18" fill="#e7c85c" /><path d="M10 24A14 14 0 0 1 31 10" stroke="#fff1b0" strokeWidth="3" strokeLinecap="round" /><path d="M38 25A14 14 0 0 1 19 38" stroke="#9e7420" strokeWidth="2" strokeLinecap="round" /></svg>
    <span>C {direction}</span>
  </span>;
}

export function SlotBrackets() {
  return <svg className="fantasy-decoration fantasy-slot-brackets" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none" aria-hidden="true" focusable="false">
    <path d="M3 24V3H24M76 3H97V24M97 76V97H76M24 97H3V76" stroke="#253b32" strokeWidth="6" vectorEffect="non-scaling-stroke" />
    <path d="M3 24V3H24M76 3H97V24M97 76V97H76M24 97H3V76" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    <path d="M8 19V8H19M81 8H92V19M92 81V92H81M19 92H8V81" stroke="#fff0bc" strokeOpacity=".8" strokeWidth="1" vectorEffect="non-scaling-stroke" />
  </svg>;
}
