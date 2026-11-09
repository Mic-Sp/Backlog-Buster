"use client";
import { useLayoutCopy } from "@/components/LayoutText";

export default function RadarNotification({ count }: { count: number }) {
  const copy = useLayoutCopy();
  if (!count) return null;
  return <span className="radar-unseen-badge" aria-label={`${count} unseen releases along your interests`}
    title={copy("Unseen releases along your interests", "Unseen chronicles close to your heart")}>{count > 99 ? "99+" : count}</span>;
}
