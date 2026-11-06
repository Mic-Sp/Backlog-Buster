"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIncomingFriendRequests } from "@/app/social-actions";
import { unwrapActionResult } from "@/lib/action-result";
import { FRIENDSHIP_CHANGE_EVENT, FRIEND_REQUEST_SEEN_PREFIX, markFriendRequestsSeen, readSeenFriendRequests, unseenFriendRequests } from "@/lib/friend-request-notifications";
import type { IncomingFriendRequest, IncomingFriendRequests } from "@/lib/social-types";

const REFRESH_MS = 30_000;
const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};

export function useFriendRequestNotifications(enabled: boolean) {
  const [incoming, setIncoming] = useState<IncomingFriendRequests | null>(null);
  const [notification, setNotification] = useState<IncomingFriendRequest[]>([]);
  const current = useRef<IncomingFriendRequests | null>(null);
  const seen = useRef<{ viewerId: string; ids: string[] } | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const dismiss = useCallback(() => {
    const data = current.current;
    if (!data) return;
    seen.current = { viewerId: data.viewerId, ids: markFriendRequestsSeen(storage, data.viewerId,
      seen.current?.viewerId === data.viewerId ? seen.current.ids : [], data.requests.map(request => request.id)) };
    setNotification([]);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true, pending = false, queued = false;
    async function load() {
      if (pending) { queued = true; return; }
      pending = true;
      try {
        const data = unwrapActionResult(await fetchIncomingFriendRequests());
        if (!active) return;
        current.current = data;
        const memory = seen.current?.viewerId === data.viewerId ? seen.current.ids : [];
        const ids = [...new Set([...readSeenFriendRequests(storage, data.viewerId), ...memory])];
        seen.current = { viewerId: data.viewerId, ids };
        setIncoming(data);
        setNotification(unseenFriendRequests(data.requests, ids));
      } catch {
        if (active) { current.current = null; setIncoming(null); setNotification([]); }
      } finally {
        pending = false;
        if (active && queued) { queued = false; void load(); }
      }
    }
    const visible = () => { if (!document.hidden) void load(); };
    const stored = (event: StorageEvent) => {
      if (event.key === null || event.key === `${FRIEND_REQUEST_SEEN_PREFIX}${current.current?.viewerId}`) visible();
    };
    refreshRef.current = () => { void load(); };
    void load();
    const timer = window.setInterval(visible, REFRESH_MS);
    window.addEventListener("focus", visible);
    window.addEventListener("storage", stored);
    window.addEventListener(FRIENDSHIP_CHANGE_EVENT, visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false; refreshRef.current = () => {};
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      window.removeEventListener("storage", stored);
      window.removeEventListener(FRIENDSHIP_CHANGE_EVENT, visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled]);

  return { count: enabled ? incoming?.total ?? 0 : 0, notification: enabled ? notification : [], dismiss, refresh };
}
