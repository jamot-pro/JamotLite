# Bring OpenClaw into the company

OpenClaw is your own assistant. Connected to Jamot, it works *inside* your
company as one of its agents: with a name in the company map, what it may see,
a history of what it did, and proposals you approve. The general recipe is
[connect-your-ai.md](connect-your-ai.md); this page is the short path.

## 1. Give it a place in the company

Add an agent to `company.yaml` (or use one that's there), for example:

```yaml
agents:
  - key: ops
    name: Ops (OpenClaw)
    role: Keeps an eye on the company and proposes fixes
```

Then connect it:

```bash
jamot mcp add ops            # add --people if it should see customers too
```

Keep the `jmt_…` token it prints: it's shown once.

## 2. Point OpenClaw at the company

In OpenClaw's MCP settings, add a **streamable HTTP** MCP server:

- **URL:** your company's address + `/mcp` — `http://127.0.0.1:3000/mcp` on
  the same machine, or `https://<your-service>.onrender.com/mcp` on Render
- **Header:** `Authorization: Bearer jmt_…`

How OpenClaw names these settings changes between versions, so follow its own
documentation for adding a remote MCP server; the URL and the header above
are all Jamot needs.

## 3. Check

Ask OpenClaw: *"What's missing in the company?"* It should answer from
`whats_missing`. Then look at the Runs page: the call is there, under **Ops
(OpenClaw)**.

To stop it: `jamot mcp revoke <id>` (`jamot mcp list` shows the id).
