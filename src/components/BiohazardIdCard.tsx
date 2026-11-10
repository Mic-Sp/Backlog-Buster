"use client";

import { useId } from "react";
import type { DossierCardProps } from "@/components/NetrunnerIdCard";
import { resolveDossierShowcase } from "@/lib/dossier";
import { customAvatarUrl, DEFAULT_AVATAR_URL, resolveAvatarPreset } from "@/lib/operator-avatar";
import OperatorEmblem from "@/components/OperatorEmblem";

/** Exportable SVG uses the same personnel-file composition as the live subscreen. */
export default function BiohazardIdCard({ data, identity, artwork, timestamp, cardRef, artworkLoading }: DossierCardProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const showcase = resolveDossierShowcase(identity.showcase, data.showcaseGames ?? data.trophies, data.trophies);
  const unlocked = data.achievements.filter(achievement => achievement.unlocked);
  const avatar = artwork[customAvatarUrl(identity.avatarUrl) ?? DEFAULT_AVATAR_URL] || artwork[DEFAULT_AVATAR_URL];
  const preset = resolveAvatarPreset(identity.avatarUrl);
  return <svg ref={cardRef} className="netrunner-id-card bio-personnel-card" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 680" width="1000" height="680" role="img" aria-labelledby={`${id}-title`}>
    <title id={`${id}-title`}>{identity.callsign} / Personnel File</title>
    <rect width="1000" height="680" fill="#242b1e" /><rect x="8" y="8" width="984" height="664" fill="none" stroke="#767e64" strokeWidth="6" />
    <g fontFamily="'Courier New', monospace" fill="#dddcca">
      <rect x="26" y="28" width="948" height="64" fill="#414a35" /><text x="48" y="54" fontSize="13" letterSpacing="2">B.B. BIO-RESEARCH DIVISION / AUTHORIZED PERSONNEL</text><text x="48" y="79" fontSize="11" fill="#b6bea0">CLASSIFIED INCIDENT RECORD / BACKLOG BUSTER</text>
      <rect x="38" y="112" width="120" height="132" fill="#12180e" stroke="#9da78b" strokeWidth="3" />
      {preset && preset !== "bb" ? <OperatorEmblem preset={preset} accent="#b5c39b" x="42" y="122" width="112" height="112" /> : avatar ? <image href={avatar} x="42" y="116" width="112" height="124" preserveAspectRatio="xMidYMid slice" /> : <OperatorEmblem preset="bb" accent="#b5c39b" x="42" y="122" width="112" height="112" />}
      <text x="184" y="134" fontSize="11" fill="#b6bea0">{identity.handle ? `OPERATIVE / @${identity.handle}` : "OPERATIVE / PERSONAL IDENTIFICATION"}</text><text x="184" y="174" fontFamily="Georgia,serif" fontSize="34">{identity.callsign.slice(0,28)}</text><text x="184" y="205" fontSize="12">{identity.tagline.slice(0,64)}</text><text x="184" y="238" fontSize="17">RANK {data.level} / {data.totalXp.toLocaleString("en-US")} LIFETIME XP</text>
      <g transform="translate(900 165)" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <path key={index} d="M0 0L-18-44H18Z" transform={`rotate(${index * 45})`} fill={index % 2 ? "#d9d8ce" : "#a3312c"} />)}</g>
      {([['Backlog','STORED'],['Playing','DEPLOYED'],['Completed','CLEARED'],['Flatlined','ARCHIVED']] as const).map(([key,label],index) => <g key={key} transform={`translate(${38 + index * 234} 274)`}><rect width="222" height="77" fill="#11180f" stroke="#778165" strokeWidth="2" /><text x="14" y="24" fontSize="11" fill="#b6bea0">{label}</text><text x="14" y="60" fontFamily="Georgia,serif" fontSize="30">{data.counts[key]}</text></g>)}
      <text x="38" y="380" fontSize="12">FIELD TIME {data.activeHours}h / CLEAR RATE {data.completionRate.toFixed(1)}% / RATING {data.avgRating?.toFixed(1) ?? "—"}</text>
      <text x="38" y="414" fontSize="12" letterSpacing="2">PERSONAL EFFECTS / FAVORITES &amp; TROPHIES</text>
      {showcase.map((slot,index) => <g key={index} transform={`translate(${38 + index * 312} 430)`}><rect width="300" height="158" fill="#151e10" stroke="#778165" strokeWidth="3" />{slot && artwork[slot.game.coverUrl ?? ""] ? <image href={artwork[slot.game.coverUrl ?? ""]!} x="7" y="7" width="88" height="112" preserveAspectRatio="xMidYMid slice" /> : <text x="34" y="70" fontSize="36" fill="#9faa87">▣</text>}<text x="110" y="28" fontSize="9" fill="#b6bea0">{slot?.pinned ? "PERSONAL FAVORITE" : "SERVICE TROPHY"}</text>{slot ? <><text x="110" y="55" fontFamily="Georgia,serif" fontSize="16">{slot.game.title.slice(0,19)}</text><text x="110" y="79" fontSize="10">{slot.game.platform.slice(0,20)}</text><text x="110" y="105" fontSize="12">{slot.game.earnedXp} XP</text><text x="12" y="141" fontSize="10">{slot.game.steamAchievementsUnlocked ?? 0} / {slot.game.steamAchievementsTotal ?? "—"} ACHIEVEMENTS</text></> : <text x="110" y="63" fontSize="12">EMPTY SLOT</text>}</g>)}
      <text x="38" y="621" fontSize="12">SERVICE COMMENDATIONS {unlocked.length} / {data.achievements.length}</text><text x="38" y="651" fontSize="9" fill="#b6bea0">{artworkLoading ? "PROCESSING PORTRAIT & PERSONAL EFFECTS…" : "PERSONNEL FILE / VERIFIED FIELD RECORD"}</text><text x="960" y="651" textAnchor="end" fontSize="9" fill="#b6bea0">{timestamp}</text>
    </g>
  </svg>;
}
