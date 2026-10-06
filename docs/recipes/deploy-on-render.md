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
fill in `JAMOT_PASSWORD`, `JAMOT_MODEL_KEY` and `JAMOT_TELEGRAM_TOKEN`, then
**Apply**.

The first boot finds no company on the disk and opens the **setup** instead
(RUNTIME D55). Open the service's `onrender.com` address, sign in with your
password and answer nine questions — or tap *Continue on Telegram* (or send
your bot the `/start <code>` from the logs) and answer them there. When you
press **Start my company**, the company is created and starts on its own;
if you set it up on Telegram you're already its owner there. Then go to
step 4. Later boots and deploys just start it.

### From a company file instead

To start from a ready company file — Jamot's own is `/app/jamot.company.yaml`
— add `JAMOT_TEMPLATE` with its path and `JAMOT_OWNER` with your name before
the first boot. The company is created from the file, and you pair with the
code in the logs (step 3).

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
