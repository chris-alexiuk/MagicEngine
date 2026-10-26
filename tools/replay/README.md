# Replay viewer

`pnpm demo` plays a full game between two simple bots through the engine (`packages/engine/scripts/demo-game.ts`), records the state after every action, and builds `.cache/replay.html`: a self-contained page that replays the game step by step with Comprehensive Rules citations.

It needs the full card DB at `apps/web/public/cards.json.gz` (`pnpm cards:build`, or download it from the `reports` branch). Pass a different seed to the demo script for a different game.
