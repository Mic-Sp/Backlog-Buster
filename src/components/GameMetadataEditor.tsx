"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import { FantasyCorners } from "@/components/FantasyAccents";
import type { GameLibraryController, LibraryGame } from "@/components/GameLibrary";
import SafeForm from "@/components/SafeForm";
import TitleAutocomplete from "@/components/TitleAutocomplete";
import type { CatalogSuggestion } from "@/lib/catalog-types";
import { useId, useRef, type RefObject } from "react";

function MetadataFields({ game, formRef }: { game: LibraryGame; formRef: RefObject<HTMLFormElement | null> }) {
  const titleId = useId();
  const customized = useRef(new Set<string>());
  const autofilled = useRef(new Set<string>());

  function clearAutofill() {
    for (const name of autofilled.current) {
      const field = formRef.current?.elements.namedItem(name);
      if (field instanceof HTMLInputElement && !customized.current.has(name)) field.value = "";
    }
    autofilled.current.clear();
  }

  function selectSuggestion(suggestion: CatalogSuggestion) {
    const values = {
      platform: suggestion.platforms[0] ?? "",
      genre: suggestion.genre ?? "",
      releaseYear: suggestion.releaseYear?.toString() ?? "",
      coverUrl: suggestion.coverUrl ?? "",
    };
    // Existing saved metadata and all saved hours are operator data. Only blank
    // fields or this edit session's untouched catalog values may be populated.
    for (const [name, value] of Object.entries(values)) {
      const field = formRef.current?.elements.namedItem(name);
      if (field instanceof HTMLInputElement && !customized.current.has(name) &&
        (!field.value.trim() || autofilled.current.has(name))) {
        field.value = value;
        autofilled.current.add(name);
      }
    }
  }

  return (
    <div className="metadata-modal-fields" onChangeCapture={(event) => {
      if (event.target instanceof HTMLInputElement && event.target.name !== "title") customized.current.add(event.target.name);
    }}>
      <div>
        <label htmlFor={titleId}>Title</label>
        <TitleAutocomplete id={titleId} defaultValue={game.title} ariaLabel={`Title for ${game.title}`} onSelect={selectSuggestion} onTitleChange={clearAutofill} />
      </div>
      <label>
        Platform
        <input name="platform" defaultValue={game.platform} maxLength={80} aria-label={`Platform for ${game.title}`} />
      </label>
      <label>
        Genre
        <input name="genre" defaultValue={game.genre ?? ""} aria-label={`Genre for ${game.title}`} />
      </label>
      <label>
        Franchise / Saga Name
        <input name="franchise" defaultValue={game.franchise ?? ""} maxLength={120} placeholder="Auto-detect, or enter a custom saga name" aria-label={`Franchise / Saga Name for ${game.title}`} />
      </label>
      <label>
        Release year
        <input name="releaseYear" type="number" min="1800" max="2100" step="1" defaultValue={game.releaseYear ?? ""} aria-label={`Release year for ${game.title}`} />
      </label>
      <label>
        Timeline / Chronological Order
        <input name="chronologicalOrder" type="number" min="1" max="10000" step="1" defaultValue={game.chronologicalOrder ?? ""} placeholder="Optional · blank uses release order" aria-label={`Timeline / Chronological Order for ${game.title}`} />
      </label>
      <label>
        Cover image URL
        <input name="coverUrl" type="url" defaultValue={game.coverUrl ?? ""} placeholder="https://..." aria-label={`Cover URL for ${game.title}`} />
      </label>
    </div>
  );
}

export default function GameMetadataEditor({ controller }: { controller: GameLibraryController }) {
  const copy = useLayoutCopy();
  const {
    editingMetaGame,
    closeMetadata,
    metadataModalRef,
  } = controller;
  return <>
      {editingMetaGame && (
        <div className="metadata-modal-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget) closeMetadata();
        }}>
          <SafeForm
            className="metadata-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="metadata-modal-title"
            ref={metadataModalRef}
            action={controller.actions.updateGame}
            onSuccess={closeMetadata}
            key={`${editingMetaGame.id}-${editingMetaGame.status}-${editingMetaGame.lengthHours}-${editingMetaGame.difficulty}-${editingMetaGame.title}-${editingMetaGame.platform}-${editingMetaGame.genre ?? ""}-${editingMetaGame.releaseYear ?? ""}-${editingMetaGame.coverUrl ?? ""}-${editingMetaGame.hoursPlayed}-${editingMetaGame.notes ?? ""}-${editingMetaGame.rating ?? ""}-${editingMetaGame.franchise ?? ""}-${editingMetaGame.chronologicalOrder ?? ""}`}
          >
            <FantasyCorners />
            <p className="eyebrow">{copy("RECORD // METADATA EDITOR", "THE SCRIBE’S DESK · QUEST DETAILS")}</p>
            <h2 id="metadata-modal-title">{copy("Edit Game Metadata", "Edit Quest Details")}</h2>
            <input type="hidden" name="id" value={editingMetaGame.id} />
            <input type="hidden" name="status" value={editingMetaGame.status} />
            <input type="hidden" name="lengthHours" value={editingMetaGame.lengthHours} />
            <input type="hidden" name="difficulty" value={editingMetaGame.difficulty} />
            <MetadataFields game={editingMetaGame} formRef={metadataModalRef} />
            <div className="metadata-modal-actions">
              <button className="metadata-save-btn" type="submit">{copy("SAVE METADATA", "SAVE QUEST DETAILS")}</button>
              <button className="metadata-cancel-btn" type="button" onClick={closeMetadata}>CANCEL</button>
            </div>
          </SafeForm>
        </div>
      )}
  </>;
}
