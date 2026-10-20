"use client";

import { startGame } from "@/app/actions";
import type { LibraryGame } from "@/components/GameLibrary";
import DeckPinButton from "@/components/DeckPinButton";
import { DECK_CAPACITY } from "@/lib/deck";

export default function UpNextDeck({ games }: { games: LibraryGame[] }) {
  const pinned = games.filter((game) => game.status === "Backlog" && game.pinnedOrder != null);

  return (
    <section className="up-next-deck" aria-labelledby="deck-title">
      <div className="deck-heading">
        <h3 id="deck-title">ON DECK // UP NEXT</h3>
        <span>{pinned.length} / {DECK_CAPACITY} SLOTS</span>
      </div>
      <ol className="deck-grid">
        {Array.from({ length: DECK_CAPACITY }, (_, index) => {
          const slot = index + 1;
          const game = pinned.find((entry) => entry.pinnedOrder === slot);
          return (
            <li key={slot}>
              {game ? (
                <form
                  action={startGame}
                  className="deck-card"
                  key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}`}
                >
                  <input type="hidden" name="id" value={game.id} />
                  <input type="hidden" name="lengthHours" value={game.lengthHours} />
                  <input type="hidden" name="difficulty" value={game.difficulty} />
                  <p className="deck-slot-badge">SLOT {String(slot).padStart(2, "0")}</p>
                  <div className="deck-game-info">
                    {game.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="deck-cover" src={game.coverUrl} alt={`${game.title} cover art`} width={64} height={86} loading="lazy" decoding="async" />
                    ) : <div className="deck-cover deck-no-cover" aria-hidden="true">NO COVER</div>}
                    <div>
                      <h4>{game.title}</h4>
                      <p>{game.platform} · {game.genre?.trim() || "Uncategorized"}</p>
                      <p>{game.lengthHours}h · <strong>{(game.lengthHours * game.difficulty * 10).toLocaleString("en-US")} POTENTIAL XP</strong></p>
                    </div>
                  </div>
                  <div className="deck-card-actions">
                    <button className="deck-start-button" type="submit">▶ START GIG</button>
                    <DeckPinButton gameId={game.id} pinnedOrder={game.pinnedOrder} pinnedCount={pinned.length} unpinOnly />
                  </div>
                </form>
              ) : (
                <div className="deck-empty-slot">
                  <p className="deck-slot-badge">SLOT {String(slot).padStart(2, "0")}</p>
                  <span>EMPTY DECK SLOT // PIN A BACKLOG GIG BELOW</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
