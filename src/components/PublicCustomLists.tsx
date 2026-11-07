"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import type { PublicCustomList } from "@/lib/custom-list-types";
import "./CustomLists.css";

export default function PublicCustomLists({ lists }: { lists: PublicCustomList[] }) {
  const copy = useLayoutCopy();
  if (!lists.length) return null;
  return <section className="custom-lists-panel public-custom-lists" aria-label="Public custom lists">
    <div className="custom-lists-heading"><div><p className="custom-lists-kicker">{copy("PUBLIC DATA SHARDS", "SCROLLS FROM THE TAVERN")}</p><h2>{copy("Curated rankings & shelves", "Rankings & treasured shelves")}</h2></div><span>{lists.length} shared</span></div>
    {lists.map(list => <details key={list.id} className="public-custom-list"><summary><strong>{list.title}</strong><span>{list.isRanked ? "Ranked" : "Shelf"} · {list.games.length} games</span></summary>
      {list.description && <p>{list.description}</p>}
      <ol className="custom-list-items" data-ranked={list.isRanked}>{list.games.map((game, index) => <li key={index}>
        {list.isRanked && <span className="custom-list-rank">{String(index + 1).padStart(2, "0")}</span>}
        {game.coverUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={game.coverUrl} alt="" loading="lazy" decoding="async" width={40} height={52} />}
        <div className="custom-list-game"><strong>{game.title}</strong><small>{game.platform}</small></div>
      </li>)}</ol>
      {!list.games.length && <p>This collection is awaiting its first pick.</p>}
    </details>)}
  </section>;
}
