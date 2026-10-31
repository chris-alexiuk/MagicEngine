import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The action bar: like a digital client's OK / Pass button, the buttons for the decision at hand always appear in one
 * place (bottom-right), with the primary one last and largest. Panels render their buttons through <Actions>; the
 * table provides the element they go into.
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
