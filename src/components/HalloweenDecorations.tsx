export default function HalloweenDecorations() {
  return <div className="halloween-decorations" aria-hidden="true">
    <svg className="haunt-web" viewBox="0 0 100 100" fill="none" focusable="false">
      <g stroke="#c5b0e1" strokeWidth="1.4" opacity=".65">
        <path d="M0 0v98M0 0h98M0 0l85 49M0 0l49 85M0 0l69 69" />
        <path d="M0 24q10-8 12-3q0-10 9-9q-3-10 3-12M0 48q16-9 24-6q-1-17 18-18q-7-14 6-24M0 72q24-11 36-10q1-23 26-26q-10-21 10-36M0 96q34-12 48-13q1-28 35-35q-11-27 13-48" />
      </g>
      <path d="M67 39v24" stroke="#c5b0e1" />
      <ellipse cx="67" cy="69" rx="7" ry="9" fill="#b4ff72" />
      <path d="m61 65-8-3m8 7-9 2m21-6 8-3m-8 7 9 2" stroke="#b4ff72" strokeWidth="2" />
      <circle cx="65" cy="67" r="1" fill="#160e21" /><circle cx="69" cy="67" r="1" fill="#160e21" />
    </svg>
    <svg className="haunt-ghost" viewBox="0 0 80 100" focusable="false">
      <path d="M13 83V42C13 3 67 3 67 42v41l-10-8-9 10-9-10-12 10-6-10Z" fill="#eee3ff" stroke="#ad91d6" strokeWidth="3" />
      <ellipse cx="31" cy="42" rx="5" ry="8" fill="#28173d" /><ellipse cx="51" cy="42" rx="5" ry="8" fill="#28173d" />
      <path d="M33 60q8 10 16 0" fill="none" stroke="#28173d" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="23" cy="56" rx="5" ry="3" fill="#ff9bb4" /><ellipse cx="59" cy="56" rx="5" ry="3" fill="#ff9bb4" />
      <path d="m13 51-8 9m62-9 8 9" stroke="#eee3ff" strokeWidth="7" strokeLinecap="round" />
    </svg>
    <svg className="haunt-pumpkin" viewBox="0 0 100 100" focusable="false">
      <path d="M49 25q-7-16 8-21l3 8q-9 2-5 14" fill="#b4ff72" stroke="#527f3b" strokeWidth="3" />
      <ellipse cx="50" cy="57" rx="44" ry="33" fill="#ff8d36" stroke="#b94725" strokeWidth="3" />
      <ellipse cx="50" cy="57" rx="27" ry="33" fill="#ffad5c" stroke="#dc682d" strokeWidth="2" />
      <path d="m23 49 14-8 5 15Zm35 7 5-15 14 8ZM25 66l12 3 4-7 8 9 8-8 5 7 13-4q-22 28-50 0" fill="#281329" stroke="#ffe08d" strokeWidth="1.5" />
      <path d="m48 57 4-7 4 7Z" fill="#281329" />
    </svg>
    <svg className="haunt-bat" viewBox="0 0 120 70" focusable="false">
      <g fill="#9670c1" stroke="#d2b2f1" strokeWidth="2">
        <path className="haunt-wing haunt-wing-left" d="M57 33Q32 5 7 10q10 16 0 32 16-12 25 4 10-5 25 2Z" />
        <path className="haunt-wing haunt-wing-right" d="M63 33Q88 5 113 10q-10 16 0 32-16-12-25 4-10-5-25 2Z" />
        <path d="m49 27-3-16 12 9h4l12-9-3 16q16 35-11 36-27-1-11-36Z" fill="#472958" />
      </g>
      <circle cx="54" cy="33" r="4" fill="#b4ff72" /><circle cx="66" cy="33" r="4" fill="#b4ff72" />
      <path d="m54 45 6 5 6-5-3 9h-6Z" fill="#fff0df" />
    </svg>
  </div>;
}
