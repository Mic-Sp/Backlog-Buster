"use client";

import { useRef, useState, useTransition } from "react";
import { acceptFriendRequest, blockPlayer, cancelFriendRequest, declineFriendRequest, removeFriend, sendFriendRequest, unblockPlayer, updateProfileVisibility } from "@/app/friendship-actions";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import type { ProfileVisibility, RelationshipState } from "@/lib/friendship-types";
import type { DossierSocialContext } from "@/lib/social-types";

export function ProfileVisibilityControl({ initialValue, onChanged }: { initialValue: ProfileVisibility; onChanged?: (value: ProfileVisibility) => void }) {
  const [value, setValue] = useState(initialValue), [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <div className="social-visibility">
    <label>Profile & activity visibility<select aria-label="Profile & activity visibility" value={value} disabled={pending} onChange={event => {
      const next = event.target.value as ProfileVisibility;
      setError("");
      startTransition(async () => {
        try { const result = unwrapActionResult(await updateProfileVisibility(next)); setValue(result.profileVisibility); onChanged?.(result.profileVisibility); }
        catch (error) { setError(actionErrorMessage(error)); }
      });
    }}><option value="public">Public</option><option value="friends">Friends only</option><option value="private">Private · only me</option></select></label>
    <small>{pending ? "Saving visibility…" : value === "private" ? "Only you can view your dossier. Your library stays out of co-op comparisons." : value === "friends" ? "Accepted friends can view your dossier, activity and shared games." : "Anyone can view your dossier. Friends can see your activity and shared games."}</small>
    {error && <p className="social-error" role="alert">{error}</p>}
  </div>;
}

export function RelationshipControls({ playerId, initialState, onChanged }: { playerId: string; initialState: RelationshipState; onChanged?: () => void }) {
  const [state, setState] = useState(initialState), [error, setError] = useState("");
  const [pending, startTransition] = useTransition(), busy = useRef(false);
  function run(action: (id: unknown) => ReturnType<typeof sendFriendRequest>) {
    if (busy.current) return;
    busy.current = true; setError("");
    startTransition(async () => {
      try { const result = unwrapActionResult(await action(playerId)); setState(result.relationship); onChanged?.(); }
      catch (error) { setError(actionErrorMessage(error)); }
      finally { busy.current = false; }
    });
  }
  return <div className="social-relationship" aria-busy={pending}>
    <div className="social-row-actions">
      {state === "none" && <button className="social-primary" type="button" disabled={pending} onClick={() => run(sendFriendRequest)}>Add friend</button>}
      {state === "incoming" && <><button className="social-primary" type="button" disabled={pending} onClick={() => run(acceptFriendRequest)}>Accept request</button><button type="button" disabled={pending} onClick={() => run(declineFriendRequest)}>Decline</button></>}
      {state === "outgoing" && <><span className="social-badge" role="status">Request pending</span><button type="button" disabled={pending} onClick={() => run(cancelFriendRequest)}>Cancel request</button></>}
      {state === "friends" && <span className="social-badge social-badge-friend" role="status">✓ Friends</span>}
      {state === "blocked" ? <button type="button" disabled={pending} onClick={() => run(unblockPlayer)}>Unblock</button> : <details className="social-manage"><summary aria-label="Manage relationship">More</summary><div>
        {state === "friends" && <button type="button" disabled={pending} onClick={() => run(removeFriend)}>Remove friend</button>}
        <button type="button" disabled={pending} onClick={() => run(blockPlayer)}>Block player</button>
      </div></details>}
    </div>
    {pending && <small role="status">Updating relationship…</small>}
    {error && <p className="social-error" role="alert">{error}</p>}
  </div>;
}

export default function DossierRelationshipControls({ context }: { context: DossierSocialContext }) {
  return <aside className="dossier-social-controls" aria-label="Dossier relationship controls">
    {context.relationship === "self" ? <p className="social-badge">Your dossier</p> : <RelationshipControls playerId={context.target.id} initialState={context.relationship} />}
  </aside>;
}
