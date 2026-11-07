"use client";
import type { PublicCustomList } from "@/lib/custom-list-types";
import { useUIEffects } from "@/components/ThemeProvider";
import "./CustomLists.css";

export default function PublicCustomLists({ lists }: { lists: PublicCustomList[] }) {
  const { layoutMode } = useUIEffects();
  if (!lists.length) return null;
  return <section className="public-custom-lists" aria-labelledby="public-lists-title">
    <p className="custom-list-kicker">{layoutMode === "fantasy" ? "CURATED SCROLLS // TAVERN SHELVES" : "PUBLIC DATA SHARDS // CURATED BY THE PLAYER"}</p>
    <h2 id="public-lists-title">{layoutMode === "fantasy" ? "The adventurer’s shelves" : "Custom lists & rankings"}</h2>
    {lists.map(list => <details key={list.id}><summary>{list.title}<span>{list.isRanked ? "Ranked" : "Shelf"} · {list.games.length} games</span></summary>
      {list.description && <p>{list.description}</p>}
      {!list.games.length && <p>No games on this shelf yet.</p>}
      <ol className="custom-list-items" data-ranked={list.isRanked} aria-label={`${list.title} games`}>{list.games.map((game, index) => <li key={index}>
        <span className="custom-list-rank" aria-hidden="true">{list.isRanked ? String(index + 1).padStart(2, "0") : "◇"}</span>
        {game.coverUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={game.coverUrl} alt="" width={48} height={60} loading="lazy" />}
        <div><strong>{game.title}</strong><small>{game.platform}</small></div>
      </li>)}</ol>
    </details>)}
  </section>;
}
