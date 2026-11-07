"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { changeCustomList } from "@/app/custom-list-actions";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import { MAX_CUSTOM_LISTS, MAX_CUSTOM_LIST_GAMES, type CustomListCommand, type CustomListData, type CustomListFields } from "@/lib/custom-list-types";
import type { GameLibraryController } from "@/components/GameLibrary";
import "./CustomLists.css";

function fields(form: HTMLFormElement): CustomListFields {
  const data = new FormData(form);
  return { title: String(data.get("title") ?? ""), description: String(data.get("description") ?? "") || null, isRanked: data.get("isRanked") === "on", isPublic: data.get("isPublic") === "on" };
}
function ListFields({ list }: { list?: CustomListData }) {
  return <>
    <label>Title<input name="title" required maxLength={80} defaultValue={list?.title ?? ""} placeholder="Your next great adventures" /></label>
    <label>Description <small>(optional)</small><textarea name="description" maxLength={280} rows={2} defaultValue={list?.description ?? ""} /></label>
    <div className="custom-list-options">
      <label><input type="checkbox" name="isRanked" defaultChecked={list?.isRanked ?? false} />Ranked · numbered 1–N</label>
      <label><input type="checkbox" name="isPublic" defaultChecked={list?.isPublic ?? false} />Show on public dossier</label>
    </div>
    <p className="custom-list-hint">Public lists follow your profile’s audience and block rules. Private lists stay in your workspace.</p>
  </>;
}

export default function CustomListsPanel({ controller: c }: { controller: GameLibraryController }) {
  const fantasy = c.layoutMode === "fantasy";
  const [editingId, setEditingId] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const addForm = useRef<HTMLFormElement>(null);
  const lists = c.customLists;
  const editing = lists.find(list => list.id === editingId) ?? lists[0];
  const gameMap = new Map(c.games.map(game => [game.id, game]));
  const available = c.games.filter(game => !editing?.gameIds.includes(game.id)).sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id);
  function run(command: CustomListCommand, success: string, onSuccess?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    startTransition(async () => {
      try {
        const result = unwrapActionResult(await changeCustomList(command));
        if (command.type === "create" && result.list) { setEditingId(result.list.id); setCreating(false); }
        if (command.type === "delete") { if (c.selectedCustomList?.id === command.id) c.selectCustomList(""); setEditingId(""); setConfirmDelete(false); }
        onSuccess?.();
        setNotice({ error: false, text: success });
      } catch (error) { setNotice({ error: true, text: actionErrorMessage(error) }); }
      finally { inFlight.current = false; }
    });
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    run({ type: "update", id: editing.id, revision: editing.revision, ...fields(event.currentTarget) }, "List saved.");
  }
  function move(index: number, direction: number) {
    if (!editing) return;
    const gameIds = [...editing.gameIds], target = index + direction;
    if (target < 0 || target >= gameIds.length) return;
    [gameIds[index], gameIds[target]] = [gameIds[target], gameIds[index]];
    run({ type: "reorder", id: editing.id, revision: editing.revision, gameIds }, "Order saved.");
  }
  return <section className="custom-lists-panel" aria-label="Custom lists">
    <header><div><p className="custom-list-kicker">{fantasy ? "CURATED SCROLLS // TAVERN SHELVES" : "DATA SHARDS // CUSTOM QUEUES"}</p><h3>{fantasy ? "Your curated shelves" : "Your custom lists"}</h3></div><span>{lists.length} / {MAX_CUSTOM_LISTS}</span></header>
    {!c.customListsEnabled ? <p>Sign in to create and curate lists from your library.</p> : <>
      <div className="custom-list-workspace-filter"><label>View custom list<select aria-label="View custom list" value={c.selectedCustomList?.id ?? ""} onChange={event => c.selectCustomList(event.target.value)}><option value="">Entire library</option>{lists.map(list => <option key={list.id} value={list.id}>{list.title} · {list.gameIds.length}{list.isRanked ? " ranked" : " games"}</option>)}</select></label>
      {c.selectedCustomList && <p>Viewing {c.selectedCustomList.title} in saved order. Status and search filters still apply.</p>}</div>
      <details className="custom-list-manager"><summary>{fantasy ? "Inscribe & arrange shelves" : "Create & manage lists"}</summary>
        <fieldset disabled={pending}>
          <div className="custom-list-toolbar">
            {!!lists.length && <label>Edit list<select aria-label="Edit custom list" value={editing?.id ?? ""} onChange={event => { setEditingId(event.target.value); setCreating(false); setConfirmDelete(false); setNotice(null); }}>{lists.map(list => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>}
            <button type="button" disabled={lists.length >= MAX_CUSTOM_LISTS} onClick={() => setCreating(value => !value)}>{creating ? "Cancel new list" : "New list"}</button>
          </div>
          {creating && <form className="custom-list-form" onSubmit={event => { event.preventDefault(); run({ type: "create", ...fields(event.currentTarget) }, "List created."); }}><h4>Create a list</h4><ListFields /><button type="submit">Create list</button></form>}
          {!creating && editing && <>
            <form className="custom-list-form" key={editing.id} onSubmit={save}><ListFields list={editing} /><div className="custom-list-toolbar"><button type="submit">Save list details</button><button type="button" onClick={() => c.selectCustomList(editing.id)}>View in library</button><button type="button" className="custom-list-danger" onClick={() => setConfirmDelete(true)}>Delete list</button></div></form>
            {confirmDelete && <div className="custom-list-delete" role="group" aria-label="Confirm list deletion"><p>Delete “{editing.title}”? Your library games will remain.</p><button type="button" onClick={() => run({ type: "delete", id: editing.id, revision: editing.revision }, "List deleted.")}>Confirm delete list</button><button type="button" onClick={() => setConfirmDelete(false)}>Keep list</button></div>}
            <div className="custom-list-items-heading"><h4>{editing.isRanked ? "Ranked games" : "Shelf contents"}</h4><span>{editing.gameIds.length} / {MAX_CUSTOM_LIST_GAMES}</span></div>
            <form className="custom-list-add" ref={addForm} onSubmit={event => { event.preventDefault(); const gameId = Number(new FormData(event.currentTarget).get("gameId")); run({ type: "add", id: editing.id, revision: editing.revision, gameId }, "Game added.", () => addForm.current?.reset()); }}>
              <label>Add a library game<select name="gameId" required defaultValue="" disabled={!available.length || editing.gameIds.length >= MAX_CUSTOM_LIST_GAMES}><option value="" disabled>Choose a game…</option>{available.map(game => <option key={game.id} value={game.id}>{game.title} · {game.platform}</option>)}</select></label><button type="submit" disabled={!available.length || editing.gameIds.length >= MAX_CUSTOM_LIST_GAMES}>Add game</button>
            </form>
            {!editing.gameIds.length && <p className="custom-list-hint">An empty shelf, ready for your picks. Add a game from your library.</p>}
            <ol className="custom-list-items" data-ranked={editing.isRanked} aria-label="Custom list games">{editing.gameIds.map((id, index) => {
              const game = gameMap.get(id);
              return game ? <li key={id}><span className="custom-list-rank" aria-hidden="true">{editing.isRanked ? String(index + 1).padStart(2, "0") : "◇"}</span><div><strong>{game.title}</strong><small>{game.platform} · {game.status === "Flatlined" && fantasy ? "Abandoned" : game.status}</small></div><div className="custom-list-item-actions"><button type="button" disabled={index === 0} aria-label={`Move ${game.title} up`} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === editing.gameIds.length - 1} aria-label={`Move ${game.title} down`} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`Remove ${game.title} from list`} onClick={() => run({ type: "remove", id: editing.id, revision: editing.revision, gameId: id }, "Game removed.")}>Remove</button></div></li> : null;
            })}</ol>
          </>}
          {!lists.length && !creating && <p>Create your first list: a ranked top ten, a weekend queue, or a shelf for a favorite genre.</p>}
        </fieldset>
      </details>
      <p className="custom-list-feedback" role={notice?.error ? "alert" : "status"} data-error={notice?.error}>{pending ? "Saving list…" : notice?.text}</p>
    </>}
  </section>;
}
