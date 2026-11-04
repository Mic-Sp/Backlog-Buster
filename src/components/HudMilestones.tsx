"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Achievement } from "@/lib/achievements";
import "./HudMilestones.css";

export default function HudMilestones({ achievements }: { achievements: Achievement[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const ribbonRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedKey = useRef<string | null>(null);
  const tooltipId = useId();
  const activeAchievement = achievements.find((achievement) => achievement.key === activeKey);

  function cancelClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  const closeTooltip = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    pinnedKey.current = null;
    setActiveKey(null);
  }, []);

  function closeAfterHover() {
    cancelClose();
    if (pinnedKey.current || document.activeElement === triggerRef.current) return;
    // Allow the pointer to cross the gap into the tooltip without dismissing it.
    closeTimer.current = setTimeout(closeTooltip, 150);
  }

  function showTooltip(button: HTMLButtonElement, key: string) {
    cancelClose();
    triggerRef.current = button;
    if (activeKey !== key) setPosition(null);
    setActiveKey(key);
  }

  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!activeAchievement) return;

    function updatePosition() {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      const ribbon = ribbonRef.current;
      if (!trigger || !tooltip || !ribbon) return;
      const anchor = trigger.getBoundingClientRect();
      const bounds = ribbon.getBoundingClientRect();
      if (anchor.right <= bounds.left || anchor.left >= bounds.right || anchor.bottom <= 0 || anchor.top >= window.innerHeight) {
        closeTooltip();
        return;
      }
      const { width, height } = tooltip.getBoundingClientRect();
      const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 12));
      const top = anchor.bottom + height + 8 <= window.innerHeight - 12
        ? anchor.bottom + 8
        : Math.max(12, anchor.top - height - 8);
      setPosition({ top, left });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeTooltip();
    }

    function handleOutsidePointerDown(event: PointerEvent) {
      if (event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) && !tooltipRef.current?.contains(event.target)) {
        closeTooltip();
      }
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    };
  }, [activeAchievement, closeTooltip]);

  return (
    <div className="hud-achievements-bar" aria-label="Player achievements">
      <span className="summary-label">Milestones {achievements.filter((achievement) => achievement.unlocked).length} / {achievements.length}</span>
      <div className="hud-achievements-pills" ref={ribbonRef} role="group" aria-label="Milestone badges">
        {achievements.map((achievement) => (
          <button
            className="hud-achievement-pill"
            type="button"
            key={achievement.key}
            data-unlocked={achievement.unlocked}
            aria-label={`${achievement.title}, ${achievement.unlocked ? "unlocked" : "locked"}`}
            aria-describedby={activeKey === achievement.key ? tooltipId : undefined}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse" && !pinnedKey.current) showTooltip(event.currentTarget, achievement.key);
            }}
            onPointerLeave={closeAfterHover}
            onFocus={(event) => {
              // Pointer activation is handled by click; keyboard focus still previews details.
              if (event.currentTarget.matches(":focus-visible")) showTooltip(event.currentTarget, achievement.key);
            }}
            onClick={(event) => {
              // Track explicit activation separately from hover/focus so the first tap always opens.
              if (pinnedKey.current === achievement.key) closeTooltip();
              else {
                pinnedKey.current = achievement.key;
                showTooltip(event.currentTarget, achievement.key);
              }
            }}
            onBlur={closeTooltip}
          >
            <span className="hud-achievement-icon" aria-hidden="true">{achievement.key === "second-heart" ? "🫀" : achievement.icon}</span>
          </button>
        ))}
      </div>
      {activeAchievement && createPortal(
        <div
          className="hud-milestone-tooltip"
          id={tooltipId}
          ref={tooltipRef}
          role="tooltip"
          data-unlocked={activeAchievement.unlocked}
          style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? "visible" : "hidden" }}
          onMouseEnter={cancelClose}
          onMouseLeave={closeAfterHover}
        >
          <div className="hud-milestone-tooltip-heading">
            <strong>{activeAchievement.title}</strong>
            <span>+{(activeAchievement.unlocked ? activeAchievement.xpAwarded : activeAchievement.xpBonus).toLocaleString("en-US")} XP</span>
          </div>
          <p>{activeAchievement.description}</p>
          <span className="hud-milestone-tooltip-status">
            {activeAchievement.unlocked
              ? `✓ UNLOCKED${activeAchievement.unlockedAt ? ` · ${activeAchievement.unlockedAt.slice(0, 10)}` : ""}`
              : `LOCKED // ${activeAchievement.current.toLocaleString("en-US")} / ${activeAchievement.target.toLocaleString("en-US")}`}
          </span>
        </div>, document.body,
      )}
    </div>
  );
}
