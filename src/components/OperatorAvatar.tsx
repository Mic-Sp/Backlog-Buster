"use client";

import { useState } from "react";
import OperatorEmblem from "@/components/OperatorEmblem";
import { customAvatarUrl, DEFAULT_AVATAR_URL, resolveAvatarPreset } from "@/lib/operator-avatar";

export default function OperatorAvatar({ avatarUrl, className, alt = "Operator avatar" }: { avatarUrl: string | null; className?: string; alt?: string }) {
  const preset = resolveAvatarPreset(avatarUrl);
  const source = customAvatarUrl(avatarUrl) ?? DEFAULT_AVATAR_URL;
  const [failed, setFailed] = useState<string[]>([]);
  if (preset && preset !== "bb") return <OperatorEmblem preset={preset} className={className} role="img" aria-hidden={false} aria-label={alt} />;
  const actual = failed.includes(source) ? DEFAULT_AVATAR_URL : source;
  if (failed.includes(actual)) return <OperatorEmblem preset="bb" className={className} role="img" aria-hidden={false} aria-label={alt} />;
  // Arbitrary user URLs use native images; errors immediately switch to the local emblem.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={actual} alt={alt} width={72} height={72} decoding="async" onError={() => setFailed(current => [...new Set([...current, actual])])} />;
}
