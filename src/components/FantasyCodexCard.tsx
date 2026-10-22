"use client";

import { useId } from "react";
import type { DossierCardProps } from "@/components/NetrunnerIdCard";
import { dossierTitleLines } from "@/lib/dossier";
import { customAvatarUrl, resolveAvatarPreset } from "@/lib/operator-avatar";
import OperatorEmblem from "@/components/OperatorEmblem";
import DossierMilestoneGlyph from "@/components/DossierMilestoneGlyph";

function Crest({ x, y, size = 70 }: { x: number; y: number; size?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size / 70})`} aria-hidden="true" pointerEvents="none">
    <circle cx="35" cy="35" r="32" fill="#285343" stroke="#d9bf70" strokeWidth="3" />
    <circle cx="35" cy="35" r="26" fill="none" stroke="#b59b55" />
    <path d="m35 13 12 21H23Zm-12 21 12 21H11Zm24 0 12 21H35Z" fill="#e5cc82" />
  </g>;
}

/** All presentation is intrinsic SVG so clipboard, PNG and print match preview. */
export default function FantasyCodexCard({ data, identity, timestamp, artwork, cardRef, artworkLoading = false }: DossierCardProps) {
  const prefix = `codex-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const accent = { cyan: "#386b56", gold: "#937128", magenta: "#8b5369" }[identity.accent];
  const unlocked = data.achievements.filter(achievement => achievement.unlocked);
  const callsign = !identity.callsign.trim() || identity.callsign === "ANONYMOUS NETRUNNER" ? "UNNAMED ADVENTURER" : identity.callsign.trim();
  const tagline = identity.tagline === "One more gig. One more legend." ? "One more quest. One more legend." : identity.tagline;
  const preset = resolveAvatarPreset(identity.avatarUrl);
  const avatarUrl = customAvatarUrl(identity.avatarUrl);
  const avatar = avatarUrl ? artwork[avatarUrl] : null;
  const stats = [
    { key: "Backlog", label: "QUESTS AWAITING" }, { key: "Playing", label: "ACTIVE JOURNEYS" },
    { key: "Completed", label: "QUESTS COMPLETED" }, { key: "Flatlined", label: "QUESTS ABANDONED" },
  ] as const;
  return <svg ref={cardRef} className="netrunner-id-card fantasy-codex-card" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 680" width="1000" height="680" role="img" aria-labelledby={`${prefix}-title ${prefix}-description`}>
    <title id={`${prefix}-title`}>{`${callsign} · Adventurer's Codex`}</title>
    <desc id={`${prefix}-description`}>Hero&apos;s Rank {data.level}, {data.totalXp.toLocaleString("en-US")} lifetime renown. {data.counts.Completed} quests completed. {unlocked.length} of {data.achievements.length} Sage Medallions awakened.</desc>
    <defs>
      <linearGradient id={`${prefix}-paper`} x2="1" y2="1"><stop stopColor="#f5e8c6" /><stop offset=".55" stopColor="#e7d5a5" /><stop offset="1" stopColor="#f0e0ba" /></linearGradient>
      {Array.from({ length: 3 }, (_, index) => <clipPath id={`${prefix}-cover-${index}`} key={index}><rect x={32 + index * 314} y="454" width="308" height="84" rx="3" /></clipPath>)}
    </defs>
    <g fontFamily="Georgia, 'Times New Roman', serif" fill="#344535">
      <rect x="3" y="3" width="994" height="674" rx="18" fill={`url(#${prefix}-paper)`} stroke="#b29950" strokeWidth="6" />
      <rect x="12" y="12" width="976" height="656" rx="12" fill="none" stroke="#9a8041" />
      <path d="M18 18H982V88H18Z" fill="#233f43" />
      <Crest x={29} y={21} size={58} />
      <text x="104" y="49" fill="#efdb9b" fontSize="25" fontWeight="700">ADVENTURER&apos;S CODEX</text>
      <text x="105" y="70" fill="#c9d4ba" fontSize="10" letterSpacing="1.5">THE ROYAL REGISTER · A RECORD OF YOUR ADVENTURES</text>
      <text x="958" y="51" textAnchor="end" fill="#e5cd84" fontSize="12">SEAL OF THE REALM</text>
      <path d="M32 96H968" stroke="#a68a44" />
      <rect x="32" y="110" width="108" height="108" rx="12" fill="#294d40" stroke="#b59b55" strokeWidth="3" />
      {avatar ? <image href={avatar} x="37" y="115" width="98" height="98" preserveAspectRatio="xMidYMid slice" />
        : preset && preset !== "bb" ? <OperatorEmblem preset={preset} accent="#d9bf70" x="37" y="115" width="98" height="98" /> : <Crest x={44} y={122} size={84} />}
      <text x="162" y="126" fontSize="11" fill="#70613d">{identity.handle ? `ADVENTURER · @${identity.handle}` : "ADVENTURER · PERSONAL RECORD"}</text>
      <text x="162" y="157" fontSize="28" fontWeight="700" fill={accent}>{callsign}</text>
      <text x="162" y="181" fontSize="13" fill="#776131">HERO&apos;S RANK {data.level} · {data.level >= 10 ? "SAGE OF THE REALM" : data.level >= 5 ? "HERO OF THE REALM" : "WAYFARER"}</text>
      <text x="162" y="204" fontSize="12">{tagline}</text>
      <text x="162" y="229" fontSize="16" fontWeight="700" fill={accent}>{data.totalXp.toLocaleString("en-US")} LIFETIME RENOWN</text>
      <Crest x={868} y={126} size={86} />
      {stats.map((stat, index) => <g key={stat.key} transform={`translate(${32 + index * 236} 250)`}>
        <rect width="228" height="70" rx="5" fill="#294b40" stroke="#b79b52" strokeWidth="2" />
        <text x="14" y="23" fill="#e8d69d" fontSize="10" letterSpacing=".8">{stat.label}</text>
        <text x="14" y="55" fill="#fff0c1" fontSize="28" fontWeight="700">{data.counts[stat.key].toLocaleString("en-US")}</text>
      </g>)}
      <text x="32" y="346" fontSize="12">JOURNEY LOG: {data.activeHours.toLocaleString("en-US")}h · QUESTS CLEARED: {data.completionRate.toFixed(1)}% · HEART RATING: {data.avgRating == null ? "UNRATED" : `${data.avgRating.toFixed(1)} / 5`}</text>
      <text x="32" y="378" fontSize="14" fontWeight="700" fill={accent}>SAGE MEDALLIONS</text>
      <text x="968" y="378" textAnchor="end" fontSize="12" fill="#75612f">{unlocked.length} / {data.achievements.length} AWAKENED</text>
      {unlocked.map((achievement, index) => <g key={achievement.key} transform={`translate(${32 + index * 42} 389)`}>
        <title>{`${achievement.title} · +${achievement.xpAwarded} XP`}</title>
        <circle cx="16" cy="16" r="16" fill="#356149" stroke="#b99b4e" strokeWidth="2" />
        <DossierMilestoneGlyph achievementKey={achievement.key} color="#e5cc82" />
      </g>)}
      {!unlocked.length && <text x="32" y="411" fontSize="12" fill="#776844">YOUR FIRST MEDALLION AWAITS · COMPLETE A QUEST</text>}
      <text x="32" y="442" fontSize="13" fontWeight="700" fill={accent}>LEGENDARY QUESTS · FIVE-HEART TROPHIES</text>
      {Array.from({ length: 3 }, (_, index) => {
        const game = data.trophies.find(entry => entry.id === identity.showcase[index]);
        const x = 32 + index * 314;
        const cover = game?.coverUrl ? artwork[game.coverUrl] : null;
        return <g key={index}>
          <rect x={x} y="454" width="308" height="164" rx="5" fill="#294b40" stroke="#b79b52" strokeWidth="2" />
          {game ? <>
            {cover ? <image href={cover} x={x} y="454" width="308" height="84" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${prefix}-cover-${index})`} />
              : <text x={x + 154} y="501" textAnchor="middle" fontSize="12" fill="#d2d8bd">{game.coverUrl ? artworkLoading ? "UNFURLING ARTWORK…" : "ARTWORK UNAVAILABLE" : "NO QUEST ARTWORK"}</text>}
            <text x={x + 12} y="559" fontSize="14" fontWeight="700" fill="#f4e6b9">{dossierTitleLines(game.title).map((line, lineIndex) => <tspan key={lineIndex} x={x + 12} dy={lineIndex === 0 ? 0 : 18}>{line}</tspan>)}</text>
            <text x={x + 12} y="602" fontSize="17" fill="#f08086">♥♥♥♥♥</text>
            <text x={x + 296} y="602" textAnchor="end" fontSize="15" fill="#ebd897">+{game.earnedXp.toLocaleString("en-US")} XP</text>
          </> : <>
            <text x={x + 154} y="505" textAnchor="middle" fontSize="32" fill="#ddc276">◇</text>
            <text x={x + 154} y="541" textAnchor="middle" fontSize="12" fill="#eddda7">RELIQUARY {index + 1}</text>
            <text x={x + 154} y="565" textAnchor="middle" fontSize="11" fill="#c2cfb8">{data.trophies.length ? "CHOOSE A FIVE-HEART TROPHY BELOW" : "RATE A COMPLETED QUEST FIVE HEARTS"}</text>
          </>}
        </g>;
      })}
      <path d="M32 635H968" stroke="#b39a56" />
      <text x="32" y="656" fontSize="10" fill="#796743">CHRONICLED · {timestamp.replace("T", " ").slice(0, 19)} UTC</text>
      <text x="968" y="656" textAnchor="end" fontSize="11" fill={accent}>YOUR STORIES. YOUR PACE. YOUR NEXT ADVENTURE.</text>
      {[false, true].map(right => <path key={String(right)} d="M22 60V22H60M28 48V28H48M30 30l21 21M36 24q0 14 14 14" transform={right ? "translate(1000 0) scale(-1 1)" : undefined} fill="none" stroke="#ccb063" strokeWidth="1.5" pointerEvents="none" />)}
    </g>
  </svg>;
}
