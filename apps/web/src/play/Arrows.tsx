import { useLayoutEffect, useState } from 'react';

/** An arrow between two things on the table: a card (by object id) or a player (by their plate). */
export interface ArrowSpec {
  from: { id: string } | { player: string };
  to: { id: string } | { player: string };
  kind: 'attack' | 'block' | 'target' | 'plan';
}

const sel = (end: ArrowSpec['from']) => ('id' in end ? `[data-id="${CSS.escape(end.id)}"]` : `[data-plate="${CSS.escape(end.player)}"] .life`);

/** Arrows for attackers, blockers and what the stack targets, drawn over the table in one SVG. */
export function Arrows({ root, arrows, version }: { root: React.RefObject<HTMLElement | null>; arrows: ArrowSpec[]; version: unknown }) {
  const [paths, setPaths] = useState<{ d: string; kind: ArrowSpec['kind']; key: string }[]>([]);
  const key = JSON.stringify(arrows);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const out: { d: string; kind: ArrowSpec['kind']; key: string }[] = [];
      for (const a of arrows) {
        const f = el.querySelector(sel(a.from));
        const t = el.querySelector(sel(a.to));
        if (!f || !t) continue;
        const fr = f.getBoundingClientRect();
        const tr = t.getBoundingClientRect();
        if (!fr.width || !tr.width) continue;
        const x1 = fr.left + fr.width / 2 - box.left;
        const y1 = fr.top + fr.height / 2 - box.top;
        let x2 = tr.left + tr.width / 2 - box.left;
        let y2 = tr.top + tr.height / 2 - box.top;
        // Stop at the target's edge, so the head is visible.
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const pull = Math.min(Math.min(tr.width, tr.height) * 0.45, len / 3);
        x2 -= (dx / len) * pull;
        y2 -= (dy / len) * pull;
        // A gentle bend, always to the same side.
        const mx = (x1 + x2) / 2 - (dy / len) * Math.min(60, len * 0.18);
        const my = (y1 + y2) / 2 + (dx / len) * Math.min(60, len * 0.18);
        out.push({ d: `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`, kind: a.kind, key: JSON.stringify(a) });
      }
      setPaths(out);
    };
    // Measure now and again once cards have finished moving.
    measure();
    const late = setTimeout(measure, 300);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      clearTimeout(late);
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  if (!paths.length) return null;
  return (
    <svg className="arrows" aria-hidden="true">
      <defs>
        {(['attack', 'block', 'target', 'plan'] as const).map((k) => (
          <marker key={k} id={`head-${k}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`head-${k}`} />
          </marker>
        ))}
      </defs>
      {paths.map((p) => (
        <path key={p.key} d={p.d} className={`arrow arrow-${p.kind}`} markerEnd={`url(#head-${p.kind})`} />
      ))}
    </svg>
  );
}
