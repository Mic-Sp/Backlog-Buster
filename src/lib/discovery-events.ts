/** Same-window feedback plus cross-tab refresh, with no personal data in storage. */
export function announceDiscoveryChange(local = true) {
  if (typeof window === "undefined") return;
  if (local) window.dispatchEvent(new Event("backlogbuster:discovery-changed"));
  try { localStorage.setItem("backlogbuster:discovery-revision", `${Date.now()}:${Math.random()}`); } catch { /* Storage is optional. */ }
}
