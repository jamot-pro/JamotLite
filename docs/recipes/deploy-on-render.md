# Run a company on Render

One Render web service, one 1 GB disk, about $7.25 a month. The whole
company — `company.db` and `secrets.key` — lives on the disk at `/data`.
[`render.yaml`](../../render.yaml) runs Jamot itself; change `JAMOT_TEMPLATE`
to run another company (`/app/templates/<id>.yaml`).

## 1. Have these ready

- A Telegram bot token: talk to [@BotFather](https://t.me/BotFather), `/newbot`.
- A model API key (Anthropic by default; set `JAMOT_MODEL` to change it,
  e.g. `openrouter/anthropic/claude-sonnet-5`).
- A console password of at least 10 characters.

## 2. Create the service

Render dashboard → **New → Blueprint** → pick this repository. When it asks,
fill in `JAMOT_OWNER` (your name), `JAMOT_PASSWORD`, `JAMOT_MODEL_KEY` and
`JAMOT_TELEGRAM_TOKEN`, then **Apply**.

The first boot finds no company on the disk and sets it up from those values
(`jamot start` does this whenever `JAMOT_TEMPLATE` is set and the folder is
empty). Later boots and deploys just start it.

### A new company, by interview

To set up a company of your own instead of the one in `render.yaml`, leave
`JAMOT_TEMPLATE` **unset** (delete it from the Blueprint's values) and keep
`JAMOT_PASSWORD`, `JAMOT_MODEL_KEY` and `JAMOT_TELEGRAM_TOKEN`. The first boot
opens the setup instead of a company: open the service's address, sign in
with your password and answer nine questions — or send your bot the
`/start <code>` from the logs and answer them on Telegram. When you press
**Start my company**, it's created and starts on its own; you're its owner
on Telegram already if you set it up there (RUNTIME D55). Then skip to step 4.

## 3. Become the owner

In the service's **Logs**, find the line

```text
  2. On Telegram, send your bot:   /start <code>
```

and send exactly that to your bot within 24 hours. Anyone who can read the
service's logs in that window could use it first, so keep the Render
workspace to people you trust. The console is at the
service's `onrender.com` address; sign in with your password.

If the code expired: **Shell** tab → `node /app/jamot.mjs pair`.

## 4. Remove the first-boot secrets

They are stored encrypted on the disk now. In **Environment**, delete
`JAMOT_PASSWORD`, `JAMOT_MODEL_KEY` and `JAMOT_TELEGRAM_TOKEN`. Keep
`JAMOT_TEMPLATE` — without a company on the disk, a boot with it set would
fail loudly instead of starting an empty one.

## 5. Backups

The company backs itself up every day into `/data/jamot/backups/` and keeps
the last 7; Render also snapshots the disk daily. Keep a copy of
`/data/jamot/secrets.key` somewhere else, once. (A company set up before S3
lives in `/data/company/` instead; it's found either way.)

To survive losing the disk too, replicate to S3-compatible storage — from the
**Shell** tab: `node /app/jamot.mjs replicate set s3://…`, then restart the
service ([backups.md](backups.md#copy-every-change-off-the-machine-litestream)). To restore, see
[backups.md](backups.md).

## Why `JAMOT_BEHIND_PROXY=1`

Render puts its HTTPS proxy in front of the service. With this set, the
login limit counts each visitor's own address (the one the proxy adds), not
the proxy's, the session cookie is marked `Secure`, and browsers are told
to use HTTPS only (RUNTIME D36).

It trusts exactly **one** proxy. If you put another in front (Cloudflare, a
CDN), the login limit would count that proxy's address instead — don't,
until the runtime learns to trust more hops.
