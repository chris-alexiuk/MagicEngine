# MagicEngine

A browser-based Magic: The Gathering rules engine for 2–4 player games, Commander first. Cards are compiled from Scryfall data without hand-scripting; anything the engine can't run yet is still playable by resolving it manually.

Status: milestone 1 of 6 (card pipeline, image cache, card browser). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm cards:fixture   # ~30-card sample DB, works offline
# or
pnpm cards:build     # downloads Scryfall's Oracle Cards file (~150 MB) and compiles every card
pnpm dev             # http://localhost:5173
```

`pnpm cards:build` also writes `apps/web/public/coverage.md`: which cards the engine fully understands, and the most common rules-text templates it doesn't yet.

## Layout

| Path | What it is |
|---|---|
| `packages/schema` | Compiled card format and ability AST, shared by everything |
| `packages/compiler` | Scryfall JSON → compiled card DB + coverage report |
| `packages/engine` | Rules engine (milestone 2) |
| `apps/web` | Browser client: card browser now, game table and deck editor later |
| `apps/server` | Authoritative game server (milestone 4) |

## Scripts

`pnpm test` · `pnpm typecheck` · `pnpm build`

The **Card database** workflow rebuilds the full DB weekly and on demand (Actions → Card database → Run workflow) and attaches it as a build artifact.

## Data

Card data and images come from [Scryfall](https://scryfall.com/docs/api). This is unofficial fan content permitted under the Wizards of the Coast Fan Content Policy; it is not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
