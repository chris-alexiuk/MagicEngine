import { activatedAbilities, manaAbilities, type Action, type GameState, type Target } from '@mtg/engine';
import { publicName } from './log';

const ALT_NAMES: Record<string, string> = {
  evoke: 'for its evoke cost',
  dash: 'with dash',
  escape: 'with escape',
  spectacle: 'for its spectacle cost',
  flashback: 'with flashback',
  foretell: 'foretold',
  plot: 'plotted (free)',
  madness: 'with madness',
  morph: 'face down (morph)',
  megamorph: 'face down (megamorph)',
  disguise: 'face down (disguise)',
  bestow: 'bestowed',
  overload: 'overloaded',
  blitz: 'with blitz',
  emerge: 'with emerge',
  prowl: 'for its prowl cost',
  surge: 'for its surge cost',
  sneak: 'with sneak',
  warp: 'with warp',
  alt: 'for its alternative cost',
};

/** What a listed action does, in words, for its button. */
export function actionLabel(g: GameState, a: Action): string {
  switch (a.type) {
    case 'pass':
      return 'Pass priority';
    case 'play_land': {
      const o = g.objects[a.object];
      const face = o ? g.cards[o.card]?.faces[a.face ?? 0] : undefined;
      return a.face ? `Play as ${face?.name ?? 'back face'}` : 'Play land';
    }
    case 'cast': {
      const o = g.objects[a.object];
      const def = o ? g.cards[o.card] : undefined;
      const face = def?.faces[a.face ?? 0];
      const parts = ['Cast'];
      if (a.face && face) parts.push(face.name);
      if (o?.zone === 'command') parts.push('from the command zone');
      else if (o?.zone === 'graveyard' && !a.alt) parts.push('from your graveyard');
      else if (o?.zone === 'exile' && !a.alt) parts.push('from exile');
      if (a.alt) parts.push(ALT_NAMES[a.alt] ?? `(${a.alt.replace(/_/g, ' ')})`);
      for (const x of a.extras ?? []) parts.push(x === 'fuse' ? 'fused' : `paying ${x.replace(/_/g, ' ')}`);
      if (a.kicked) parts.push(typeof a.kicked === 'number' && a.kicked > 1 ? `kicked ×${a.kicked}` : 'kicked');
      if (a.x !== undefined) parts.push(`(X = ${a.x})`);
      return parts.join(' ');
    }
    case 'activate': {
      const o = g.objects[a.object];
      const ab = o ? activatedAbilities(g, o)[a.ability] : undefined;
      const text = ab?.text ?? `ability ${a.ability + 1}`;
      return a.x !== undefined && /X/.test(text) ? `${text} (X = ${a.x})` : text;
    }
    case 'activate_mana': {
      const o = g.objects[a.object];
      const ab = o ? manaAbilities(g, o)[a.ability] : undefined;
      const effect = ab?.effects.find((e) => e.type === 'add_mana') as { options?: string[][] } | undefined;
      let what = '';
      if (typeof a.choice === 'string') what = a.choice.length === 1 ? `{${a.choice}}` : [...a.choice].map((c) => `{${c}}`).join('');
      else if (typeof a.choice === 'number' && effect?.options?.[a.choice]) what = effect.options[a.choice]!.map((c) => `{${c}}`).join('');
      const bonus = a.bonus?.length ? ` (+${a.bonus.map((b) => (typeof b === 'string' ? `{${b}}` : String(b))).join('')})` : '';
      return what ? `Add ${what}${bonus}` : `${ab?.text ?? 'Mana ability'}${bonus}`;
    }
    case 'activate_manual': {
      const o = g.objects[a.object];
      const line = o ? g.cards[o.card]?.faces[o.face]?.unparsed[a.line] : undefined;
      return `${line ?? 'Ability'} (resolve by hand)`;
    }
    case 'turn_face_up':
      return 'Turn face up';
    case 'unlock': {
      const o = g.objects[a.object];
      return `Unlock ${o ? (g.cards[o.card]?.faces[a.half]?.name ?? 'door') : 'door'}`;
    }
    case 'foretell':
      return 'Foretell';
    case 'plot':
      return 'Plot';
    case 'suspend':
      return 'Suspend';
    case 'concede':
      return 'Concede';
    case 'choose':
      return 'Choose';
    case 'manual':
      return 'Manual move';
  }
}

export function targetLabel(g: GameState, t: Target): string {
  if (t.kind === 'player') return g.players[t.player]?.name ?? t.player;
  if (t.kind === 'ability') {
    const e = g.stack.find((s) => s.kind === 'ability' && s.id === t.entry);
    return e && e.kind === 'ability' ? `${e.sourceName}’s ability` : 'an ability';
  }
  return publicName(t.object, g);
}

export const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === 'player' ? a.player === (b as typeof a).player : a.kind === 'object' ? a.object === (b as typeof a).object : a.entry === (b as typeof a).entry);

/** The object an action is about, for grouping actions by card. */
export function actionObject(a: Action): string | null {
  return 'object' in a && typeof a.object === 'string' ? a.object : null;
}
