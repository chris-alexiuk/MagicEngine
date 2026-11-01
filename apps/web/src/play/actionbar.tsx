import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ArrowSpec } from './Arrows';

/**
 * Where a decision's buttons go: the action bar at the bottom right of the table (or an overlay's own button row).
 * Choice panels render their buttons through <Actions>, so every decision's buttons are in the same place.
 */
export const ActionBarSlot = createContext<HTMLElement | null>(null);

export function Actions({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  const el = useContext(ActionBarSlot);
  const content = (
    <div className="actions">
      {hint ? <p className="actions-hint">{hint}</p> : null}
      <div className="actions-buttons">{children}</div>
    </div>
  );
  return el ? createPortal(content, el) : content;
}

/** Panels inside choices can draw arrows on the table (planned attacks and blocks). */
export const PlanArrows = createContext<(a: ArrowSpec[]) => void>(() => {});
