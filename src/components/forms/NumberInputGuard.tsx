'use client';

import { useEffect } from 'react';

/**
 * Stops the browser from changing a number field by itself (Lineu,
 * 2026-11-19). With the spinner hidden (globals.css), ArrowUp/ArrowDown and
 * the mouse wheel over a focused field would still nudge an amount by 1 —
 * silently, on a figure the household typed. One listener for every
 * `input[type=number]` in the app, so a new field cannot forget it.
 * Renders nothing.
 */
type FieldLike = { tagName?: string; type?: string; blur?: () => void };

export function isNumberInput(target: unknown): target is FieldLike & { blur: () => void } {
  const t = target as FieldLike | null;
  return !!t && t.tagName === 'INPUT' && t.type === 'number';
}

export function onNumberKeyDown(e: { key: string; target: unknown; preventDefault: () => void }): void {
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isNumberInput(e.target)) e.preventDefault();
}

/** A focused number field changes on wheel; blur it so the page scrolls instead. */
export function onNumberWheel(e: { target: unknown }, activeElement: unknown): void {
  if (isNumberInput(e.target) && activeElement === e.target) e.target.blur();
}

export default function NumberInputGuard() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => onNumberKeyDown(e);
    const onWheel = (e: WheelEvent) => onNumberWheel(e, document.activeElement);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, []);
  return null;
}
