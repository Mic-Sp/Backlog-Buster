"use client";

import { useState } from "react";
import { useUIEffects } from "@/components/ThemeProvider";
import { HeroCrest } from "@/components/FantasyAccents";
import OperatorEmblem from "@/components/OperatorEmblem";
import { customAvatarUrl, DEFAULT_AVATAR_URL, resolveAvatarPreset } from "@/lib/operator-avatar";

export default function OperatorAvatar({ avatarUrl, className, alt = "Operator avatar", fantasyFallback = false }: { avatarUrl: string | null; className?: string; alt?: string; fantasyFallback?: boolean }) {
  const { layoutMode } = useUIEffects();
  const preset = resolveAvatarPreset(avatarUrl);
  const source = customAvatarUrl(avatarUrl) ?? DEFAULT_AVATAR_URL;
  const [failed, setFailed] = useState<string[]>([]);
  if (fantasyFallback && layoutMode === "fantasy" && (preset === "bb" || failed.includes(source))) return <HeroCrest className={className} role="img" aria-label={alt} />;
  if (preset && preset !== "bb") return <OperatorEmblem preset={preset} className={className} role="img" aria-hidden={false} aria-label={alt} />;
  const actual = failed.includes(source) ? DEFAULT_AVATAR_URL : source;
  if (failed.includes(actual)) return <OperatorEmblem preset="bb" className={className} role="img" aria-hidden={false} aria-label={alt} />;
  // Arbitrary user URLs use native images; errors immediately switch to the local emblem.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={actual} alt={alt} width={72} height={72} decoding="async" onError={() => setFailed(current => [...new Set([...current, actual])])} />;
}
