import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ArrowSpec } from './Arrows';

/**
 * Where a decision's buttons go: the action bar at the bottom right of the table (or an overlay's own button row).
 * Choice panels render their buttons through <Actions>, so every decision's buttons are in the same place.
 */
export const ActionBarSlot = createContext<HTMLElement | null>(null);

/** `aside`: a small control that sits on the hint's line, at its end (the "Hold priority" switch). */
export function Actions({ children, hint, aside }: { children: ReactNode; hint?: ReactNode; aside?: ReactNode }) {
  const el = useContext(ActionBarSlot);
  const content = (
    <div className="actions">
      {aside ? (
        <div className="actions-head">
          {hint ? (
            <p className="actions-hint" title={typeof hint === 'string' ? hint : undefined}>
              {hint}
            </p>
          ) : null}
          {aside}
        </div>
      ) : hint ? (
        <p className="actions-hint">{hint}</p>
      ) : null}
      <div className="actions-buttons">{children}</div>
    </div>
  );
  return el ? createPortal(content, el) : content;
}

/** Panels inside choices can draw arrows on the table (planned attacks and blocks). */
export const PlanArrows = createContext<(a: ArrowSpec[]) => void>(() => {});
