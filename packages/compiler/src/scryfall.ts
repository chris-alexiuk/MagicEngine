/** The subset of Scryfall's Card object the compiler reads. https://scryfall.com/docs/api/cards */

export interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
}

export interface ScryfallFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  image_uris?: ScryfallImageUris;
  oracle_id?: string;
  /** The name this printing gives the face instead of its own (Universes Beyond and Secret Lair reskins). */
  flavor_name?: string;
  printed_name?: string;
}

export interface ScryfallCard {
  object: string;
  id: string;
  oracle_id?: string;
  name: string;
  layout: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  legalities?: Record<string, string>;
  games?: string[];
  digital?: boolean;
  set: string;
  set_type?: string;
  rarity: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallFace[];
  game_changer?: boolean;
  edhrec_rank?: number;
  /** Printing details — on every card object, read from the all-printings file (see printings.ts). */
  lang?: string;
  collector_number?: string;
  released_at?: string;
  /** The name this printing gives the card instead of its own ("Seymour Guado" on a Kinnan, Bonder Prodigy). */
  flavor_name?: string;
  /** The name as printed, when that isn't the card's name. */
  printed_name?: string;
}

export interface ScryfallBulkItem {
  type: string;
  updated_at: string;
  /** Gzipped JSON Lines, one card per line (current API). */
  jsonl_download_uri?: string;
  compressed_size?: number;
  /** Plain JSON array (older API responses). */
  download_uri?: string;
  size?: number;
}
