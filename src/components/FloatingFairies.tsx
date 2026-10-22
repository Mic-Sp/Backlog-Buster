"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import "./FloatingFairies.css";

const colors = ["#ffd4ed", "#c8ffd9", "#ccefff"];

export default function FloatingFairies() {
  const layerRef = useRef<HTMLDivElement>(null);
  const glowId = useId();

  useEffect(() => {
    // Randomize once after hydration. CSS handles all ongoing motion, without
    // timers or React renders, and the server's initial markup stays stable.
    layerRef.current?.querySelectorAll<HTMLElement>(".floating-fairy").forEach((fairy) => {
      fairy.style.setProperty("--fairy-duration", `${22 + Math.random() * 16}s`);
      fairy.style.setProperty("--fairy-delay", `${-Math.random() * 38}s`);
      fairy.style.setProperty("--fairy-sway", `${4 + Math.random() * 12}px`);
      fairy.style.setProperty("--fairy-flutter", `${.6 + Math.random() * .7}s`);
    });
  }, []);

  return <div className="floating-fairies" ref={layerRef} aria-hidden="true">
    {(["left", "right"] as const).map((side, sideIndex) => <div className="floating-fairy-lane" data-side={side} key={side}>
      {colors.map((color, index) => {
        const number = sideIndex * 3 + index;
        const gradientId = `${glowId}-${number}`;
        const style = {
          color,
          "--fairy-x": `${28 + index * 22}%`,
          "--fairy-rest-y": `${22 + index * 28 + sideIndex * 6}%`,
          "--fairy-duration": `${25 + number * 2}s`,
          "--fairy-delay": `${-number * 5}s`,
        } as CSSProperties;
        return <span className="floating-fairy" style={style} key={color}>
          <svg className="floating-fairy-sprite" viewBox="0 0 64 64" width="28" height="28" focusable="false">
            <defs><radialGradient id={gradientId}>
              <stop stopColor="currentColor" stopOpacity=".65" />
              <stop offset=".4" stopColor="currentColor" stopOpacity=".3" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </radialGradient></defs>
            <circle cx="32" cy="33" r="29" fill={`url(#${gradientId})`} />
            <g fill="currentColor" fillOpacity=".35" stroke="currentColor" strokeOpacity=".65" strokeWidth=".8">
              <path className="floating-fairy-wing-left" d="M30 33C7 32 5 8 17 14c9 4 13 14 13 19Zm0 1C11 32 10 48 19 46c6-1 9-7 11-12Z" />
              <path className="floating-fairy-wing-right" d="M34 33C57 32 59 8 47 14c-9 4-13 14-13 19Zm0 1c19-2 20 14 11 12-6-1-9-7-11-12Z" />
            </g>
            <circle cx="32" cy="33" r="7" fill="currentColor" fillOpacity=".8" />
            <circle cx="32" cy="33" r="3.5" fill="#fffff5" />
          </svg>
        </span>;
      })}
    </div>)}
  </div>;
}
