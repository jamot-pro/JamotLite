# Let customers talk to the company from a browser

The web chat is a page at `/chat` on the company's address. A customer
writes, an agent answers, and the customer becomes a person the company
remembers — like a Telegram chat, without Telegram.

It's **off** until you turn it on, and while it's off `/chat` doesn't exist.

## Turn it on

```bash
jamot webchat on --cap 2      # at most $2 of replies a day (UTC)
jamot webchat status
jamot webchat off
```

Or from the console: `PUT /api/webchat` with `{ "enabled": true, "dailyCapUsd": 2 }`.
The change applies to the next request; no restart.

## Make it reachable

Jamot listens on `127.0.0.1` by default, so only the machine itself can open
it (RUNTIME D39). To let customers in:

- **On Render** (or any host with an HTTPS proxy in front): it's already
  public — `https://<your-service>.onrender.com/chat`. Keep
  `JAMOT_BEHIND_PROXY=1` ([deploy-on-render.md](deploy-on-render.md)).
- **On your own machine:** put an HTTPS reverse proxy or tunnel in front
  (Caddy, Cloudflare Tunnel, Tailscale Funnel) that forwards to
  `127.0.0.1:3000`, set `JAMOT_BEHIND_PROXY=1`, and expose **only `/chat`**
  if you can. The console and `/mcp` are protected by your password and the
  MCP token, but there's no reason to show them to the world.

## What keeps it safe

| Limit | Value |
|---|---|
| A message | 2,000 characters |
| One visitor | 6 messages a minute, and only after opening the page |
| New visitors | 10 a minute from one address (clearing cookies doesn't start over) |
| The whole web chat | 60 messages a minute |
| Open pages | 3 per visitor, 200 in all |
| Spending | the daily cap; then new messages wait until midnight UTC and you get one Telegram message |

- A visitor is known by a signed cookie that only works on `/chat`. It is not
  a console session and opens nothing else.
- Every message, both ways, goes into the company's memory of that person,
  like every other channel.
- **Forget me** on the page erases what the visitor wrote, the company's
  memories of them, the agents' transcripts of the conversation, the words of
  every agent run about it, and the person. Run costs stay, without any words.
- Anything an agent wants to do that waits for approval still waits for you;
  a visitor can never approve it.
