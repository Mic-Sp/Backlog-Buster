"use client";

import useCooldown from "@/components/useCooldown";
import { DEFAULT_COOLDOWN_SECONDS } from "@/lib/cooldown";
import { actionErrorMessage, ActionFailure, unwrapActionResult } from "@/lib/action-result";

import SafeForm from "@/components/SafeForm";
import TitleAutocomplete from "@/components/TitleAutocomplete";
import type { CatalogSuggestion } from "@/lib/catalog-types";

import { useId, useRef, useState, useTransition } from "react";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { createGame, searchGameInfo } from "./actions";

const defaultPlatforms = ["PC", "Switch", "PS5", "Retro"];

export default function GameForm() {
  const cooldown = useCooldown();
  const searchingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const customizedFields = useRef(new Set<string>());
  const autofilledFields = useRef(new Set<string>());
  const [formVersion, setFormVersion] = useState(0);
  const [platformOptions, setPlatformOptions] = useState(defaultPlatforms);
  const [lookupMessage, setLookupMessage] = useState("");
  const [isSearching, startSearch] = useTransition();

  async function addGame(data: FormData) {
    const result = unwrapActionResult(await createGame(data));
    window.dispatchEvent(new CustomEvent("backlogbuster:game-added", { detail: result.gameId }));
    setLookupMessage("");
    customizedFields.current.clear();
    autofilledFields.current.clear();
    setFormVersion((version) => version + 1);
    return result;
  }

  function fillMetadata(values: Record<string, string>) {
    for (const [name, value] of Object.entries(values)) {
      const field = formRef.current?.elements.namedItem(name);
      if (field instanceof HTMLInputElement && !customizedFields.current.has(name)) {
        field.value = value;
        autofilledFields.current.add(name);
      }
    }
  }

  function clearAutofill() {
    fillMetadata(Object.fromEntries([...autofilledFields.current].map((name) => [name, ""])));
    autofilledFields.current.clear();
    setLookupMessage("");
  }

  function selectSuggestion(suggestion: CatalogSuggestion) {
    fillMetadata({
      platform: suggestion.platforms[0] ?? "",
      coverUrl: suggestion.coverUrl ?? "",
      genre: suggestion.genre ?? "",
      releaseYear: suggestion.releaseYear?.toString() ?? "",
      lengthHours: suggestion.estimatedHours?.toString() ?? "",
    });
    setPlatformOptions((options) => [...new Set([...options, ...suggestion.platforms])]);
    setLookupMessage("Title selected. Review or edit the suggested details.");
  }

  function searchForGame() {
    if (searchingRef.current || cooldown.seconds > 0) return;
    const form = formRef.current;
    const titleField = form?.elements.namedItem("title");
    const title = titleField instanceof HTMLInputElement
      ? titleField.value.trim()
      : "";

    if (!title) {
      setLookupMessage("Please input a valid title.");
      return;
    }

    searchingRef.current = true;
    startSearch(async () => {
      const startedAt = Date.now();
      try {
        const gameInfo = unwrapActionResult(await searchGameInfo(title));
        cooldown.start(DEFAULT_COOLDOWN_SECONDS, startedAt);
        const currentForm = formRef.current;
        const currentTitle = currentForm?.elements.namedItem("title");
        if (!(currentTitle instanceof HTMLInputElement) || currentTitle.value.trim() !== title) return;

        if (!gameInfo) {
          setLookupMessage("No match found. You can still add the game manually.");
          return;
        }

        if (currentForm) {
          const setInputValue = (name: string, value: string) => fillMetadata({ [name]: value });

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
            setInputValue("lengthHours", String(rawgLengthHours));
          }
        }

        if (gameInfo.platforms.length > 0) {
          setPlatformOptions([
            ...new Set([...defaultPlatforms, ...gameInfo.platforms]),
          ]);
        }
        setLookupMessage("Game info found. Review or edit the suggestions.");
      } catch (error) {
        if (error instanceof ActionFailure) cooldown.start(error.retryAfterSeconds);
        setLookupMessage(actionErrorMessage(error, "Lookup unavailable.") + " You can still add the game manually.");
      } finally { searchingRef.current = false; }
    });
  }

  return (
    <SafeForm action={addGame} className="game-form" ref={formRef} onChangeCapture={(event) => {
      if (event.target instanceof HTMLInputElement && event.target.name !== "title") {
        customizedFields.current.add(event.target.name);
      }
    }}>
      <div className="field field-title">
        <label htmlFor={titleId}>Game title</label>
        <div className="title-search-row">
          <TitleAutocomplete key={formVersion} id={titleId} onSelect={selectSuggestion} onTitleChange={clearAutofill} />
          <button
            className="search-button"
            disabled={isSearching || cooldown.seconds > 0}
            onClick={searchForGame}
            type="button"
          >
            {cooldown.seconds > 0 ? cooldown.label : isSearching ? "Searching..." : "Search Game Info"}
          </button>
        </div>
        <span className="lookup-message" aria-live="polite">{lookupMessage}</span>
      </div>

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
    </SafeForm>
  );
}
