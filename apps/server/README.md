# Game server (milestone 4)

Authoritative game host. Runs the same `@mtg/engine` package as the client.

- One room per game; players connect over WebSockets.
- The server holds the full game state. Each client receives a redacted view (its own hand, public zones, counts of hidden zones), so hidden information stays hidden.
- Clients send actions and answers to `PendingChoice`s; the server applies them and broadcasts events.
- Host-agnostic Node process; hosting gets picked at milestone 4.
