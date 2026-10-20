"use client";

import { useId, type Ref } from "react";
import { dossierAccents, dossierTitleLines, getStreetCred, type DossierData, type DossierIdentity } from "@/lib/dossier";
import DossierMilestoneGlyph from "@/components/DossierMilestoneGlyph";

export default function NetrunnerIdCard({ data, identity, timestamp, artwork, cardRef }: {
  data: DossierData;
  identity: DossierIdentity;
  timestamp: string;
  artwork: Record<string, string | null>;
  cardRef: Ref<SVGSVGElement>;
}) {
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const accent = dossierAccents[identity.accent];
  const unlocked = data.achievements.filter((achievement) => achievement.unlocked);
  const signature = [...unlocked].sort((left, right) => (right.unlockedAt ?? "").localeCompare(left.unlockedAt ?? "") || right.xpAwarded - left.xpAwarded)[0];
  const stats = [
    { status: "Backlog", label: "BACKLOG QUEUE", color: accent },
    { status: "Playing", label: "ACTIVE PLAYING", color: "#05ffa1" },
    { status: "Completed", label: "GIGS CLEARED", color: "#fcee0a" },
    { status: "Flatlined", label: "FLATLINED", color: "#ff8bad" },
  ] as const;
  const outline = "22,2 998,2 998,658 978,678 2,678 2,22";
  const callsign = identity.callsign.trim() || "ANONYMOUS NETRUNNER";
  const avatar = artwork[data.profile.avatarUrl || "/hud-logo.png"];

  return (
    <svg ref={cardRef} className="netrunner-id-card" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 680" width="1000" height="680" role="img" aria-labelledby={`${prefix}-title ${prefix}-description`}>
      <title id={`${prefix}-title`}>{callsign}{" // Netrunner ID Card"}</title>
      <desc id={`${prefix}-description`}>Level {data.level}, {data.totalXp.toLocaleString("en-US")} lifetime XP. {stats.map((stat) => `${data.counts[stat.status]} ${stat.status}`).join(", ")}. {unlocked.length} of {data.achievements.length} milestones unlocked. {data.activeHours} active hours logged.</desc>
      <defs>
        <linearGradient id={`${prefix}-holo`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={accent} /><stop offset="0.5" stopColor="#fcee0a" /><stop offset="1" stopColor="#ff2a6d" />
        </linearGradient>
        <pattern id={`${prefix}-scan`} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0H4" stroke="#c2f8ff" strokeOpacity="0.13" /></pattern>
        <clipPath id={`${prefix}-frame`}><polygon points={outline} /></clipPath>
        {Array.from({ length: 3 }, (_, index) => <clipPath id={`${prefix}-cover-${index}`} key={index}><rect x={32 + index * 314} y="452" width="308" height="86" /></clipPath>)}
      </defs>
      <g clipPath={`url(#${prefix}-frame)`} fontFamily="'Courier New', monospace" fill="#dce6f3">
        <rect width="1000" height="680" fill="#080d16" />
        <path d="M0 0H1000V78H0Z" fill="#101e29" />
        <path d="M0 78H1000" stroke={accent} strokeOpacity="0.6" />
        <text x="32" y="34" fontSize="14" fontWeight="700" fill={accent} letterSpacing="0.8">NIGHT CITY RECREATIONAL TELEMETRY // CITIZEN DOSSIER</text>
        <text x="32" y="58" fontSize="10" fill="#91a4b9" letterSpacing="2">BACKLOG BUSTER / INDEPENDENT OPERATOR REGISTRY</text>
        <g fill="#c2e8ef" aria-hidden="true">
          {Array.from({ length: 38 }, (_, index) => <rect key={index} x={808 + index * 4} y="24" width={index % 3 === 0 ? 3 : 1} height={index % 5 === 0 ? 32 : 25} />)}
        </g>
        <text x="964" y="65" textAnchor="end" fontSize="8" fill="#91a4b9">NC-R/T // CAREER VERIFIED</text>

        <rect x="32" y="100" width="114" height="114" fill="#111827" stroke={accent} />
        {avatar ? <image href={avatar} x="36" y="104" width="106" height="106" preserveAspectRatio="xMidYMid slice" /> : <text x="89" y="174" textAnchor="middle" fontSize="50" fontWeight="700" fill={accent}>BB</text>}
        <text x="168" y="122" fontSize="10" fill="#91a4b9" letterSpacing="2">OPERATOR // PERSONAL IDENTIFICATION</text>
        <text x="168" y="152" fontSize="28" fontWeight="700" fill="#f3fff9">{callsign.toUpperCase()}</text>
        <text x="168" y="175" fontSize="11" fill={accent}>LV {data.level} {getStreetCred(data.level).toUpperCase()}{" // "}{signature?.title.toUpperCase() ?? "NEW CONTRACTOR"}</text>
        <text x="168" y="199" fontSize="11" fill="#c3cfdf">{identity.tagline}</text>
        <text x="168" y="225" fontSize="16" fontWeight="700" fill="#fcee0a">LV {data.level.toLocaleString("en-US")}</text>
        <text x="283" y="225" fontSize="16" fontWeight="700" fill="#e6fff9">{data.totalXp.toLocaleString("en-US")} LIFETIME XP</text>
        <g transform="translate(888 160)" aria-hidden="true">
          <path d="M0-48 42-24 42 24 0 48-42 24-42-24Z" fill="#101d27" stroke={`url(#${prefix}-holo)`} strokeWidth="2" />
          <circle r="35" fill="none" stroke={`url(#${prefix}-holo)`} strokeDasharray="3 4" />
          <text y="-9" textAnchor="middle" fontSize="9" fill={accent}>AUTHENTIC</text>
          <text y="14" textAnchor="middle" fontSize="28" fontWeight="700" fill="#fcee0a">BB</text>
          <text y="29" textAnchor="middle" fontSize="7" fill="#91a4b9">LOCAL OPERATOR</text>
        </g>

        {stats.map((stat, index) => (
          <g key={stat.status} transform={`translate(${32 + index * 236} 252)`}>
            <rect width="228" height="72" fill="#0e1823" stroke="#2e3a52" />
            <path d="M0 0H44" stroke={stat.color} strokeWidth="2" />
            <text x="14" y="23" fontSize="10" fill="#a8b9cb" letterSpacing="1">{stat.label}</text>
            <text x="14" y="56" fontSize="28" fontWeight="700" fill={stat.color}>{data.counts[stat.status].toLocaleString("en-US")}</text>
          </g>
        ))}
        <text x="32" y="348" fontSize="11" fill="#a7bdcf">ACTIVE LOG: <tspan fill="#e6fff9">{data.activeHours.toLocaleString("en-US")}h</tspan>{"  //  CLEAR RATE: "}<tspan fill="#e6fff9">{data.completionRate.toFixed(1)}%</tspan>{"  //  CRITIC AVG: "}<tspan fill="#fcee0a">{data.avgRating == null ? "UNRATED" : `${data.avgRating.toFixed(1)} ★`}</tspan></text>

        <text x="32" y="378" fontSize="11" fontWeight="700" fill={accent} letterSpacing="1">MILESTONE MICRO-RIBBON</text>
        <text x="968" y="378" fontSize="11" textAnchor="end" fill="#fcee0a">{unlocked.length} / {data.achievements.length} UNLOCKED</text>
        {unlocked.map((achievement, index) => (
          <g key={achievement.key} transform={`translate(${32 + index * 42} 390)`}>
            <title>{achievement.title}{" // +"}{achievement.xpAwarded} XP</title>
            <rect width="32" height="32" rx="3" fill="#1c231b" stroke="#b5a934" />
            <rect x="2" y="2" width="28" height="28" rx="2" fill="none" stroke="#4a5230" />
            <DossierMilestoneGlyph achievementKey={achievement.key} />
          </g>
        ))}
        {!unlocked.length && <text x="32" y="412" fontSize="11" fill="#7f95aa">NO MILESTONES YET // THE FIRST CONTRACT AWAITS</text>}

        <text x="32" y="442" fontSize="11" fontWeight="700" fill={accent} letterSpacing="1">TOP CLEARED GIGS // FIVE-STAR TROPHIES</text>
        {Array.from({ length: 3 }, (_, index) => {
          const game = data.trophies.find((entry) => entry.id === identity.showcase[index]);
          const x = 32 + index * 314;
          const cover = game?.coverUrl ? artwork[game.coverUrl] : null;
          return (
            <g key={index}>
              <rect x={x} y="452" width="308" height="166" fill="#101925" stroke={game ? "#8d8432" : "#2e3a52"} strokeDasharray={game ? undefined : "4 4"} />
              {game ? <>
                {cover ? <image href={cover} x={x} y="452" width="308" height="86" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${prefix}-cover-${index})`} /> : <>
                  <rect x={x + 1} y="453" width="306" height="84" fill="#172333" />
                  <text x={x + 154} y="500" textAnchor="middle" fontSize="11" fill="#91a4b9">{game.coverUrl ? "ARTWORK OFFLINE" : "NO COVER ON FILE"}</text>
                </>}
                <text x={x + 12} y="559" fontSize="14" fontWeight="700" fill="#f5f7e8">{dossierTitleLines(game.title).map((line, lineIndex) => <tspan key={lineIndex} x={x + 12} dy={lineIndex === 0 ? 0 : 18}>{line}</tspan>)}</text>
                <text x={x + 12} y="602" fontSize="16" fill="#fcee0a">★★★★★</text>
                <text x={x + 296} y="602" textAnchor="end" fontSize="15" fontWeight="700" fill="#fcee0a">+{game.earnedXp.toLocaleString("en-US")} XP</text>
              </> : <>
                <text x={x + 154} y="510" textAnchor="middle" fontSize="28" fill="#4a5a6c">★</text>
                <text x={x + 154} y="544" textAnchor="middle" fontSize="11" fill="#91a4b9">SHOWCASE SLOT {String(index + 1).padStart(2, "0")}</text>
                <text x={x + 154} y="566" textAnchor="middle" fontSize="10" fill="#71869c">{data.trophies.length ? "SELECT A FIVE-STAR TROPHY BELOW" : "RATE A COMPLETED GIG FIVE STARS"}</text>
              </>}
            </g>
          );
        })}
        <path d="M32 635H968" stroke="#2e3a52" />
        <text x="32" y="657" fontSize="10" fill="#91a4b9">SNAPSHOT // {timestamp.replace("T", " ").slice(0, 19)} UTC</text>
        <text x="968" y="657" textAnchor="end" fontSize="10" fill={accent}>STAY SHARP. CLEAR THE QUEUE. // BB-2077</text>
        <rect width="1000" height="680" fill={`url(#${prefix}-scan)`} pointerEvents="none" />
      </g>
      <polygon points={outline} fill="none" stroke={accent} strokeWidth="5" strokeOpacity="0.15" />
      <polygon points={outline} fill="none" stroke={accent} strokeWidth="1.5" />
      <path d="M30 2H130M998 26V110M870 678H966M2 570V646" fill="none" stroke="#fcee0a" strokeWidth="3" />
    </svg>
  );
}
