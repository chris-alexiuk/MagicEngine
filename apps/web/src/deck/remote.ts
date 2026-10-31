/**
 * Best-effort imports from deck-site URLs, straight from the browser.
 *
 * Moxfield's API sits behind Cloudflare and sends no CORS headers, so a browser fetch is usually refused; Archidekt's
 * sometimes works. There's deliberately no proxy server: when a fetch fails, the user is told how to export the list as
 * text instead. A successful fetch is turned into deck-list text and goes through the same parser as pasted text, so
 * unmatched names show up the same way.
 */

export type DeckSite = { site: 'moxfield'; id: string } | { site: 'archidekt'; id: string };

export function parseDeckUrl(input: string): DeckSite | null {
  const s = input.trim();
  const mox = /moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i.exec(s);
  if (mox) return { site: 'moxfield', id: mox[1]! };
  const arch = /archidekt\.com\/(?:api\/)?decks\/(\d+)/i.exec(s);
  if (arch) return { site: 'archidekt', id: arch[1]! };
  return null;
}

export class RemoteImportError extends Error {}

export const EXPORT_HELP: Record<DeckSite['site'], string> = {
  moxfield: 'On Moxfield, open the deck, choose More → Export, then “Copy for MTGO” (or “Copy as plain text”), and paste it here.',
  archidekt: 'On Archidekt, open the deck, choose Export (the download icon), pick “Text”, copy it, and paste it here.',
};

interface MoxCard {
  quantity: number;
  card: { name: string };
}
interface MoxDeck {
  name?: string;
  boards?: Record<string, { cards?: Record<string, MoxCard> }>;
}

interface ArchidektDeck {
  name?: string;
  categories?: { name: string; includedInDeck?: boolean; isPremier?: boolean }[];
  cards?: { quantity: number; categories?: string[] | null; card?: { oracleCard?: { name?: string } } }[];
}

async function getJSON(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' });
  } catch {
    throw new RemoteImportError('The site refused a direct request from the browser (no CORS access, or it’s offline).');
  }
  if (!res.ok) throw new RemoteImportError(`The site answered HTTP ${res.status}${res.status === 403 ? ' (blocked by its bot protection)' : res.status === 404 ? ' (no such public deck)' : ''}.`);
  try {
    return await res.json();
  } catch {
    throw new RemoteImportError('The site answered with something other than deck data (probably a bot-protection page).');
  }
}

export function moxfieldToText(d: MoxDeck): string {
  const section = (title: string, board?: { cards?: Record<string, MoxCard> }) => {
    const cards = Object.values(board?.cards ?? {});
    return cards.length ? [title, ...cards.map((c) => `${c.quantity} ${c.card.name}`), ''] : [];
  };
  const b = d.boards ?? {};
  return [...section('Commander', b.commanders), ...section('Companion', b.companions), ...section('Deck', b.mainboard), ...section('Sideboard', b.sideboard)].join('\n');
}

export function archidektToText(d: ArchidektDeck): string {
  const outOfDeck = new Set((d.categories ?? []).filter((c) => c.includedInDeck === false).map((c) => c.name));
  const premier = new Set((d.categories ?? []).filter((c) => c.isPremier).map((c) => c.name));
  const commander: string[] = [];
  const main: string[] = [];
  const side: string[] = [];
  for (const c of d.cards ?? []) {
    const name = c.card?.oracleCard?.name;
    if (!name) continue;
    const cats = c.categories ?? [];
    const line = `${c.quantity} ${name}`;
    if (cats.some((x) => x === 'Commander' || premier.has(x))) commander.push(line);
    else if (cats.length && cats.every((x) => outOfDeck.has(x))) side.push(line);
    else main.push(line);
  }
  return [...(commander.length ? ['Commander', ...commander, ''] : []), 'Deck', ...main, ...(side.length ? ['', 'Sideboard', ...side] : [])].join('\n');
}

/** Fetches a deck as deck-list text, or throws a RemoteImportError saying what went wrong. */
export async function fetchDeckText(where: DeckSite): Promise<{ text: string; name?: string }> {
  if (where.site === 'moxfield') {
    const d = (await getJSON(`https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(where.id)}`)) as MoxDeck;
    if (!d || typeof d !== 'object' || !d.boards) throw new RemoteImportError('Moxfield’s answer had no deck in it.');
    return { text: moxfieldToText(d), ...(d.name ? { name: d.name } : {}) };
  }
  const d = (await getJSON(`https://archidekt.com/api/decks/${encodeURIComponent(where.id)}/`)) as ArchidektDeck;
  if (!d || typeof d !== 'object' || !Array.isArray(d.cards)) throw new RemoteImportError('Archidekt’s answer had no deck in it.');
  return { text: archidektToText(d), ...(d.name ? { name: d.name } : {}) };
}
