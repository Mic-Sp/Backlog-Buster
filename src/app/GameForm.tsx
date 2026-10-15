"use client";

import { useRef, useState, useTransition } from "react";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { createGame, searchGameInfo } from "./actions";

const defaultPlatforms = ["PC", "Switch", "PS5", "Retro"];

export default function GameForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [platformOptions, setPlatformOptions] = useState(defaultPlatforms);
  const [lookupMessage, setLookupMessage] = useState("");
  const [isSearching, startSearch] = useTransition();

  function searchForGame() {
    const form = formRef.current;
    const titleField = form?.elements.namedItem("title");
    const title = titleField instanceof HTMLInputElement
      ? titleField.value.trim()
      : "";

    if (!title) {
      setLookupMessage("Enter a title to search. You can still add it manually.");
      return;
    }

    startSearch(async () => {
      try {
        const gameInfo = await searchGameInfo(title);
        const currentForm = formRef.current;

        if (!gameInfo) {
          setLookupMessage("No match found. You can still add the game manually.");
          return;
        }

        if (currentForm) {
          const setInputValue = (name: string, value: string) => {
            const field = currentForm.elements.namedItem(name);
            if (field instanceof HTMLInputElement) {
              field.value = value;
            }
          };

          if (gameInfo.platforms[0]) {
            setInputValue("platform", gameInfo.platforms[0]);
          }
          if (gameInfo.coverUrl) {
            setInputValue("coverUrl", gameInfo.coverUrl);
          }
          if (gameInfo.genre) {
            setInputValue("genre", gameInfo.genre);
          }
          if (gameInfo.releaseYear) {
            setInputValue("releaseYear", String(gameInfo.releaseYear));
          }
          const genreField = currentForm.elements.namedItem("genre");
          const resolvedGenre = genreField instanceof HTMLInputElement
            ? genreField.value.trim() || gameInfo.genre
            : gameInfo.genre;
          const rawgLengthHours = resolveRawgPlaytime(
            gameInfo.playtime,
            resolvedGenre,
          );
          const lengthHoursField = currentForm.elements.namedItem("lengthHours");
          if (
            lengthHoursField instanceof HTMLInputElement &&
            lengthHoursField.value.trim() === "" &&
            rawgLengthHours !== null
          ) {
            lengthHoursField.value = String(rawgLengthHours);
          }
        }

        if (gameInfo.platforms.length > 0) {
          setPlatformOptions([
            ...new Set([...defaultPlatforms, ...gameInfo.platforms]),
          ]);
        }
        setLookupMessage("Game info found. Review or edit the suggestions.");
      } catch {
        setLookupMessage("Lookup unavailable. You can still add the game manually.");
      }
    });
  }

  return (
    <form action={createGame} className="game-form" ref={formRef}>
      <label className="field field-title">
        <span>Game title</span>
        <div className="title-search-row">
          <input
            autoComplete="off"
            maxLength={120}
            name="title"
            placeholder="What are you playing next?"
            required
          />
          <button
            className="search-button"
            disabled={isSearching}
            onClick={searchForGame}
            type="button"
          >
            {isSearching ? "Searching..." : "Search Game Info"}
          </button>
        </div>
        <span className="lookup-message" aria-live="polite">{lookupMessage}</span>
      </label>

      <label className="field">
        <span>Platform</span>
        <input
          autoComplete="off"
          defaultValue=""
          list="game-platform-options"
          maxLength={80}
          name="platform"
          placeholder="Choose or enter a platform"
        />
        <datalist id="game-platform-options">
          {platformOptions.map((platform) => (
            <option key={platform} value={platform} />
          ))}
        </datalist>
      </label>

      <label className="field field-hours">
        <span>Length <small>(hours)</small></span>
        <input
          inputMode="numeric"
          max="10000"
          min="1"
          name="lengthHours"
          placeholder="10"
          step="1"
          type="number"
        />
      </label>

      <label className="field">
        <span>Difficulty</span>
        <select name="difficulty" defaultValue="1" required>
          <option value="1">1 · Easy</option>
          <option value="2">2 · Medium</option>
          <option value="3">3 · Tough</option>
        </select>
      </label>

      <label className="field field-cover">
        <span>Cover image URL <small>(optional)</small></span>
        <input
          autoComplete="url"
          inputMode="url"
          maxLength={2048}
          name="coverUrl"
          placeholder="https://..."
          type="text"
        />
      </label>

      <label className="field">
        <span>Genre <small>(optional)</small></span>
        <input autoComplete="off" maxLength={80} name="genre" placeholder="RPG" />
      </label>

      <label className="field">
        <span>Release year <small>(optional)</small></span>
        <input
          inputMode="numeric"
          max="2100"
          min="1800"
          name="releaseYear"
          placeholder="2024"
          step="1"
          type="number"
        />
      </label>

      <button className="add-button" type="submit">
        <span aria-hidden="true">+</span> Add game
      </button>
    </form>
  );
}