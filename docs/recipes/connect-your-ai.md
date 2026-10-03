# Connect your AI to your company

Your company is an MCP server. Any AI that speaks MCP — Claude, Claude Code,
Cursor, Hermes — can connect and ask it things: *what's missing? who wrote
today? what did the agents cost this month?*

## 1. Get the address and the token

```bash
jamot mcp
```

prints something like:

```text
URL:   http://127.0.0.1:3000/mcp
Token: 3m1Hc…                # keep it like a password
```

The token is created on the first start and stored encrypted with the
company's `secrets.key`.

## 2. Connect

**Claude Code**

```bash
claude mcp add --transport http my-company http://127.0.0.1:3000/mcp --header "Authorization: Bearer <token>"
```

**Any other client** — add an HTTP (streamable) MCP server with that URL and
an `Authorization: Bearer <token>` header.

If the runtime runs on another machine, reach it through a tunnel you trust
(Tailscale, Cloudflare Tunnel). The port listens on 127.0.0.1 by default.

## 3. Ask

- *What's missing in my company?* → `whats_missing`
- *How are we doing?* → `company_overview` (readiness, money runway, who's waiting)
- *What do we know about Mrs. Rossi?* → `people_search`, `person_profile`
- *Remember that the flour supplier closes in August.* → `memory_note`
- *What did the agents do today, and what did it cost?* → `runs_recent`
- *Is anything waiting for me?* → `approvals_pending`

## What it can't do

Your AI can read and note things down. It **cannot approve** anything an agent
is waiting for: approvals stay with a person pressing a button on Telegram, so
a leaked token can't move money.

## Give your agents MCP tools

The other direction: an MCP server your company uses (a stock system, a
booking system, Home Assistant) becomes tools for the agents that can reach it
in the company map.

```yaml
tools:
  - key: t-stock
    name: Stock system
    mcp:
      url: https://stock.example.com/mcp
      tokenSecret: stock.token      # stored with `jamot secret set stock.token`
      allow: [check_stock]          # these run straight away
      allowPrivateNetwork: false    # true for a server on your own LAN
links:
  - buyer uses t-stock
```

Tools not listed in `allow` wait for your approval on Telegram.
