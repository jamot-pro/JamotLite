# Backups and restoring

A company's whole life is two files in its folder: `company.db` (everything
it knows) and `secrets.key` (what unlocks its stored secrets). Lose the first
and the company forgets; lose the second and its tokens and keys are gone.

## What happens on its own

While the company runs, it takes a consistent snapshot of `company.db` once a
day into `backups/` in its folder, and keeps the last 7. The **Backups**
vital sign turns red when the newest one is more than 48 hours old, and the
owner hears about it on Telegram.

`secrets.key` is never copied into `backups/`. A snapshot without it holds
no readable secret, so it's safe to copy anywhere. Keep the key somewhere
else — a password manager is fine — and only once: it doesn't change.

These snapshots sit on the same disk as the company, so they protect against
mistakes and damage, not against losing the disk. For that, replicate.

## Copy every change off the machine (Litestream)

[Litestream](https://litestream.io) streams each change of `company.db` to
S3-compatible storage — AWS S3, Cloudflare R2, Backblaze B2, Tigris, MinIO.
The Docker image has it; elsewhere, install it so `litestream` is on the PATH
(or point `JAMOT_LITESTREAM` at it).

```bash
jamot replicate set "s3://my-bucket/jamot?endpoint=<account>.r2.cloudflarestorage.com&region=auto"
# asks for the bucket's access key id and secret (or JAMOT_REPLICA_ACCESS_KEY_ID
# and JAMOT_REPLICA_SECRET_ACCESS_KEY when nothing can be typed)
jamot replicate status
```

Restart the company and it replicates for as long as it runs, restarting
Litestream if it stops. The keys are kept in the secret store and given to
Litestream only, never written to a file or a log.

**`secrets.key` is never replicated.** A replica without it holds no readable
secret, so a leaked bucket gives away no tokens — and a lost key means the
company's stored tokens and keys are gone. Keep one copy of it somewhere else,
once.

To bring the company back from the replica — after losing the disk, or on a
new machine with the same `secrets.key`:

```bash
jamot replicate restore      # stages the replica's latest copy
# then restart the company
```

`jamot replicate off` stops it and forgets the keys.

## Take one now

```bash
jamot backup                 # into backups/, counted in the last 7
jamot backup --to ~/jamot.db # anywhere else, outside the rotation
```

## Restore

Look first — nothing changes:

```bash
jamot restore latest --dry-run
```

```text
/data/jamot/backups/company-2026-10-03T02-00-00-000Z.db
  company: Jamot · 3 people · 41 memories · last message 2026-10-03T01:58:12.000Z
```

Then stage it and restart the company:

```bash
jamot restore latest         # or a file: jamot restore backups/company-….db
```

The backup is checked, then left as `restore.db`. On the next start, before
anything is opened, it takes the company's place; the company as it was is copied
to `backups/before-restore-….db`, so a restore can itself be undone the same
way. This works from a shell beside a running company — on Render, run it in
the **Shell** tab, then **Manual Deploy → Restart service**.
