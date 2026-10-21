import type { SVGProps } from "react";
import type { AvatarPreset } from "@/lib/operator-avatar";

// Native vector geometry stays sharp in both the HUD and exported SVG/PNG dossier.
export default function OperatorEmblem({ preset, accent = "#00f0ff", ...props }: SVGProps<SVGSVGElement> & { preset: AvatarPreset; accent?: string }) {
  return <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" data-avatar-preset={preset} {...props}>
    <rect width="100" height="100" rx="3" fill="#080e18" />
    <path d="M4 27V4H27M73 4H96V27M96 73V96H73M27 96H4V73" stroke={accent} strokeWidth="2" />
    <g stroke={accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round">
      {preset === "bb" && <><path d="M30 20V80H55Q77 80 77 64Q77 50 55 50Q75 50 75 35Q75 20 55 20ZM40 30H54Q64 30 64 36Q64 42 54 42H40ZM40 57H55Q66 57 66 65Q66 72 55 72H40Z" /><path d="M18 8V32L10 40M85 60L92 67V88M18 90V75L25 68" stroke="#fcee0a" /></>}
      {preset === "kitsune" && <><path d="M17 15L39 32H61L83 15L77 60L50 86L23 60Z" fill="#11212c" /><path d="M23 28L36 44L26 49M77 28L64 44L74 49M31 54L43 58L37 65M69 54L57 58L63 65M43 72L50 77L57 72M50 37V55" /><path d="M30 51L42 54M70 51L58 54" stroke="#ff2a6d" strokeWidth="4" /></>}
      {preset === "skull" && <><path d="M24 48V36Q24 16 50 16Q76 16 76 36V57L65 66V80H35V66L24 57Z" fill="#11212c" /><path d="M31 40L43 44V55H31ZM69 40L57 44V55H69ZM46 62L50 56L54 62M42 72V80M50 72V80M58 72V80M20 29H12V17M80 29H88V17M19 57H10V75M81 57H90V75" /><circle cx="12" cy="13" r="3" /><circle cx="88" cy="13" r="3" /></>}
      {preset === "samurai" && <><path d="M27 47Q27 22 50 22Q73 22 73 47L80 71L65 80H35L20 71Z" fill="#11212c" /><path d="M27 44L12 25L18 13L38 32M73 44L88 25L82 13L62 32M31 48H69L65 62H35ZM40 70H60M38 76H62M50 22V40M26 58L17 65M74 58L83 65" /><path d="M38 52H62" stroke="#fcee0a" strokeWidth="4" /></>}
      {preset === "cortex" && <><path d="M50 15L79 32V66L50 83L21 66V32Z" fill="#11212c" /><path d="M50 29L66 39V58L50 68L34 58V39ZM50 29V15M66 39L79 32M66 58L79 66M50 68V83M34 58L21 66M34 39L21 32M8 42H21M79 42H92M8 57H21M79 57H92" /><circle cx="50" cy="49" r="8" fill={accent} stroke="#e6fff9" /><path d="M41 7H59M41 91H59" stroke="#fcee0a" /></>}
      {preset === "terminal" && <><rect x="16" y="21" width="68" height="52" rx="5" fill="#11212c" /><path d="M24 29H76V63H24ZM38 74V82H62V74M31 83H69M32 39L41 46L32 53M49 54H62" /><path d="M28 34H72M28 58H72" strokeOpacity="0.25" /><circle cx="74" cy="68" r="1" fill="#fcee0a" /></>}
    </g>
  </svg>;
}
