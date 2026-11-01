import { useLayoutEffect, useRef } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Cards glide to where the new state puts them (hand to stack, stack to battlefield, battlefield to graveyard pile):
 * every element with a data-id is measured after each render, and when the game moves on, each one that changed
 * place is animated from its old position (a FLIP animation). Window resizes don't animate. Respects reduced motion.
 */
export function useCardMotion(root: React.RefObject<HTMLElement | null>, version: unknown) {
  const last = useRef<Map<string, DOMRect>>(new Map());
  const lastVersion = useRef(version);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const now = new Map<string, DOMRect>();
    const nodes = el.querySelectorAll<HTMLElement>('[data-id]');
    nodes.forEach((n) => now.set(n.dataset.id!, n.getBoundingClientRect()));
    const moved = lastVersion.current !== version;
    lastVersion.current = version;
    if (moved && !reduced()) {
      nodes.forEach((n) => {
        const before = last.current.get(n.dataset.id!);
        const after = now.get(n.dataset.id!);
        if (!before || !after || !after.width) return;
        const dx = before.left + before.width / 2 - (after.left + after.width / 2);
        const dy = before.top + before.height / 2 - (after.top + after.height / 2);
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        const s = before.width && after.width ? before.width / after.width : 1;
        n.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, zIndex: 50 }, { transform: 'none', zIndex: 50 }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' });
      });
    }
    last.current = now;
  });
}
