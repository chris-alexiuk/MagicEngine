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
}

export interface ScryfallBulkItem {
  type: string;
  download_uri: string;
  updated_at: string;
  size: number;
}
