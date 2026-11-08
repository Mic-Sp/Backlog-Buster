"use client";

import { useRef, useState, useTransition } from "react";
import WorkspaceSection from "@/components/WorkspaceSection";
import { useLayoutCopy } from "@/components/LayoutText";
import type { GameLibraryController, LibraryGame } from "@/components/GameLibrary";
import { createCustomList, updateCustomList, deleteCustomList, updateCustomListItems } from "@/app/custom-list-actions";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import { MAX_CUSTOM_LISTS, MAX_LIST_GAMES, type CustomListData } from "@/lib/custom-list-types";
import "./CustomLists.css";

export default function CustomLists({ controller: c }: { controller: GameLibraryController }) {
  const copy = useLayoutCopy();
  const [editorId, setEditorId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const managerRef = useRef<HTMLDetailsElement>(null);
  const editor = c.customLists.find(list => list.id === editorId);
  const creating = editorId === "new";

  function run(operation: () => Promise<unknown>, message: string, after?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    startTransition(async () => {
      try { unwrapActionResult(await operation()); setNotice({ text: message, error: false }); after?.(); }
      catch (error) { setNotice({ text: actionErrorMessage(error), error: true }); }
      finally { inFlight.current = false; }
    });
  }
  function edit(id: string) { setEditorId(id); setConfirmDelete(false); setNotice(null); if (managerRef.current) managerRef.current.open = true; }

  return <WorkspaceSection sectionKey="custom-lists" className="custom-lists-panel" label="custom lists" busy={pending}
    title={copy("Your curated collections", "The curator’s shelves")} eyebrow={copy("DATA SHARDS // CUSTOM QUEUES", "CURATED SCROLLS // TAVERN SHELVES")}
    summary={<><span className="workspace-section-count">{c.customLists.length} / {MAX_CUSTOM_LISTS} shelves</span>{c.selectedCustomList && <span className="workspace-section-filter" title={`Active list: ${c.selectedCustomList.title}`}>Active: {c.selectedCustomList.title}</span>}</>}>
    {!c.socialEnabled ? <p>Sign in to create your own lists and ranked shelves.</p> : <>
      <div className="custom-list-toolbar">
        <label>View custom list<select value={c.selectedCustomList?.id ?? ""} onChange={event => c.selectCustomList(event.target.value)} disabled={pending}>
          <option value="">Full library</option>{c.customLists.map(list => <option key={list.id} value={list.id}>{list.title} · {list.gameIds.length} {list.isRanked ? "ranked" : "games"}</option>)}
        </select></label>
        {c.selectedCustomList && <button type="button" disabled={pending} onClick={() => edit(c.selectedCustomList!.id)}>Edit selected list</button>}
      </div>
      {c.selectedCustomList && <p className="custom-list-view-note">{c.selectedCustomList.isRanked ? "Ranked queue" : "Ordered shelf"} · {c.selectedCustomList.isPublic ? "Shared on dossier" : "Private"}{c.selectedCustomList.description && ` — ${c.selectedCustomList.description}`}<br />Library filters narrow this list. Default sorting preserves your saved order.</p>}
      {!c.customLists.length && <p className="custom-list-empty">{copy("Build a weekend queue, rank your favorites, or collect a new obsession.", "Gather a weekend’s adventures, rank your legends, or start a shelf of hidden gems.")}</p>}
      <details className="custom-list-manager" ref={managerRef}><summary>Manage lists</summary>
        <fieldset disabled={pending}>
          <div className="custom-list-toolbar"><label>Edit custom list<select value={editorId ?? ""} onChange={event => edit(event.target.value)}><option value="">Choose a list…</option>{c.customLists.map(list => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>
            <button type="button" disabled={c.customLists.length >= MAX_CUSTOM_LISTS} onClick={() => edit("new")}>New list</button>
          </div>
          {c.customLists.length >= MAX_CUSTOM_LISTS && <p>All 20 shelves are in use. Delete one to make room.</p>}
          {(creating || editor) && <>
            <ListDetailsForm key={`${editor?.id ?? "new"}:${editor?.title}:${editor?.description}:${editor?.isRanked}:${editor?.isPublic}`} list={editor} onSave={details => {
              if (creating) run(async () => {
                const result = unwrapActionResult(await createCustomList(details));
                setEditorId(result.id);
              }, "List created.");
              else run(() => updateCustomList(editor!.id, details), "List saved.");
            }} />
            {editor && <>
              <div className="custom-list-actions"><button type="button" onClick={() => c.selectCustomList(editor.id)}>View in library</button>
                {!confirmDelete ? <button type="button" className="custom-list-delete" onClick={() => setConfirmDelete(true)}>Delete list</button> : <>
                  <span>Delete “{editor.title}”? Games stay in your library.</span><button type="button" className="custom-list-delete" onClick={() => run(() => deleteCustomList(editor.id), "List deleted.", () => { setEditorId(null); setConfirmDelete(false); })}>Confirm delete list</button><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </>}
              </div>
              <ListItems list={editor} games={c.games} change={(input, message) => run(() => updateCustomListItems(editor.id, input), message)} />
            </>}
          </>}
        </fieldset>
      </details>
    </>}
    {notice && <p className="custom-list-notice" role={notice.error ? "alert" : "status"} data-error={notice.error}>{notice.text}</p>}
  </WorkspaceSection>;
}

function ListDetailsForm({ list, onSave }: { list?: CustomListData; onSave: (details: Record<string, unknown>) => void }) {
  return <form className="custom-list-details" onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave({ title: data.get("title"), description: data.get("description"), isRanked: data.has("isRanked"), isPublic: data.has("isPublic") });
  }}>
    <label>Title<input name="title" required maxLength={80} defaultValue={list?.title ?? ""} placeholder="e.g. My top RPGs" /></label>
    <label>Description (optional)<textarea name="description" rows={2} maxLength={280} defaultValue={list?.description ?? ""} placeholder="What makes this collection yours?" /></label>
    <div className="custom-list-flags"><label><input type="checkbox" name="isRanked" defaultChecked={list?.isRanked ?? false} />Ranked · numbered 1–N</label><label><input type="checkbox" name="isPublic" defaultChecked={list?.isPublic ?? false} />Show on public dossier</label></div>
    <p className="custom-list-help">Private by default. Public lists follow your profile’s visibility and block settings.</p>
    <button type="submit">{list ? "Save list details" : "Create list"}</button>
  </form>;
}

function ListItems({ list, games, change }: { list: CustomListData; games: LibraryGame[]; change: (input: unknown, message: string) => void }) {
  const [gameId, setGameId] = useState("");
  const available = games.filter(game => !list.gameIds.includes(game.id)).sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id);
  const selectedId = available.some(game => String(game.id) === gameId) ? gameId : "";
  const byId = new Map(games.map(game => [game.id, game]));
  return <WorkspaceSection sectionKey="list-membership" className="custom-list-membership" label="list contents" headingLevel={4}
    title={list.isRanked ? "Ranked picks" : "Shelf contents"} summary={<span className="workspace-section-count">{list.gameIds.length} / {MAX_LIST_GAMES} games</span>}>
    <div className="custom-list-toolbar"><label>Add a library game<select value={selectedId} onChange={event => setGameId(event.target.value)} disabled={list.gameIds.length >= MAX_LIST_GAMES}><option value="">Choose a game…</option>{available.map(game => <option value={game.id} key={game.id}>{game.title} · {game.platform}</option>)}</select></label><button type="button" disabled={!selectedId || list.gameIds.length >= MAX_LIST_GAMES} onClick={() => change({ type: "add", gameId: Number(selectedId) }, "Game added.")}>Add game</button></div>
    <ol className="custom-list-items" data-ranked={list.isRanked}>{list.gameIds.map((id, index) => {
      const game = byId.get(id);
      return <li key={id}>{list.isRanked && <span className="custom-list-rank" aria-label={`Rank ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>}
        <div className="custom-list-game"><strong>{game?.title ?? "Unavailable game"}</strong><small>{game?.platform} · {game?.status}</small></div>
        <div className="custom-list-item-actions"><button type="button" aria-label={`Move ${game?.title} up`} disabled={index === 0} onClick={() => change({ type: "move", gameId: id, direction: -1 }, "Order saved.")}>↑</button><button type="button" aria-label={`Move ${game?.title} down`} disabled={index === list.gameIds.length - 1} onClick={() => change({ type: "move", gameId: id, direction: 1 }, "Order saved.")}>↓</button><button type="button" aria-label={`Remove ${game?.title} from list`} onClick={() => change({ type: "remove", gameId: id }, "Game removed.")}>Remove</button></div>
      </li>;
    })}</ol>
    {!list.gameIds.length && <p className="custom-list-empty">An empty shelf, ready for your first pick.</p>}
    {list.gameIds.length >= MAX_LIST_GAMES && <p>This shelf is full. Remove a game to add another.</p>}
  </WorkspaceSection>;
}
