# Connect Claude, and see the company inside it

claude.ai (on the web, desktop and phone) connects to your company as a
**custom connector**. It signs in with OAuth: you approve it once on a page of
your own company, and it joins as someone in the company map, like any
[connected AI](connect-your-ai.md). Then ask Claude to *show the company*, and
the dashboard opens inside the conversation.

You need the company reachable over HTTPS: on Render that's the
`https://….onrender.com` address, which Jamot reads on its own. Elsewhere, set
`JAMOT_PUBLIC_URL=https://your.address` before `jamot start`.

## 1. Add the connector

In Claude: **Settings → Connectors → Add custom connector**.

- **Name:** your company's name
- **URL:** `https://<your company address>/mcp`

Leave the OAuth fields empty. Claude finds out how to sign in by itself.

## 2. Say yes on your company's page

Claude opens a page served by **your** company:

> **Claude** from **claude.ai** wants to connect to **Jamot** over MCP.

Check the address in the browser is your company, and that the app comes from
`claude.ai`. Then:

- **It connects as**: pick the agent or person it acts as. Everything it does
  shows up under that name, on the Runs page and in `jamot mcp list`.
- **It may also see people**: tick only if it should read customers and their
  conversations.
- **Console password**: asked every time you connect an app.

**Allow**, and you're back in Claude, connected.

## 3. Use it

- *Show me the company* → the **dashboard**: readiness and what's missing, the
  company map, recent activity, and proposals waiting for a person. Its
  Refresh button asks again; nothing is decided from it.
- *What's missing?*, *What did the agents do today?*: the same tools as any
  [connected AI](connect-your-ai.md#3-ask).
- *Propose giving the menu to Lucia*: Claude may **propose**; the proposal
  comes to you on Telegram, and nothing happens until a person approves.

## What it can and can't do

The sign-in becomes a connection, with the same rules as one made by hand:
30 calls a minute, 5 proposals waiting at most, its own runs only, and never
an approval. Its access token lasts an hour, and Claude renews it with a refresh
token that works once and ends after 30 days unused.

```bash
jamot mcp list          # … · signed in from Claude (claude.ai)
jamot mcp revoke <id>   # ends it now: the next call is refused
```

## Claude Code, Claude Desktop and other clients

- **Claude Code**: `claude mcp add --transport http jamot https://<address>/mcp`
  signs in the same way. Or use a token from `jamot mcp add` with
  `--header "Authorization: Bearer <token>"`.
- **Any MCP client** that supports OAuth: give it the `/mcp` address. Clients
  that identify themselves with a metadata document (CIMD) and clients that
  register themselves are both accepted.
- The dashboard shows in hosts that support **MCP Apps**. Elsewhere,
  `company_dashboard` answers with a one-line summary, and the other tools give
  the details as text.

## When it doesn't work

- **"This app can't connect"** on the page: the client asked to be sent back
  to an address it never declared, or its metadata couldn't be read. Nothing
  was granted.
- **Claude says it can't reach the server**: open
  `https://<address>/.well-known/oauth-protected-resource/mcp` in a browser. Its
  `resource` must be your `https://…/mcp` address. If it says `http://` or the
  wrong host, set `JAMOT_PUBLIC_URL`.
- **"Too many tries"**: five wrong passwords in a minute. Wait a minute.
