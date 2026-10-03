# Many companies, one machine

Each company is its own folder and its own process: its own database, secret
key, port, Telegram bot, model key and spending limits. Nothing is shared but
the machine (RUNTIME D1, D35, D42). This page runs two side by side.

## 1. Two companies, two folders

```bash
jamot import templates/restaurant.yaml      # → ~/.jamot/restaurant
jamot import templates/bali-cafe.yaml       # → ~/.jamot/bali-cafe
```

Give each its own bot, model key and password — they never share one:

```bash
jamot secret set telegram.botToken --company restaurant
jamot secret set model.apiKey      --company restaurant
jamot password                     --company restaurant
# …and the same for --company bali-cafe
```

## 2. Two processes, two ports

```bash
jamot start --company restaurant --port 3000
jamot start --company bali-cafe  --port 3001
```

Starting a company that's already running is refused, naming the process
that has it — two runtimes never share a folder. A company whose process
died starts again normally.

### As services (start with the machine, restart if they stop)

```bash
jamot service install --company restaurant --port 3000
jamot service install --company bali-cafe  --port 3001
```

Each gets its own unit (`jamot-<id>.service`) or LaunchAgent
(`pro.jamot.<id>`). On Linux, cap each one so neither can starve the other:

```bash
systemctl --user edit jamot-restaurant
# [Service]
# MemoryMax=512M
# CPUQuota=50%
```

### As containers

```yaml
# compose.yaml
services:
  restaurant:
    image: ghcr.io/jamot-pro/jamot-lite
    volumes: ["restaurant:/data"]
    ports: ["127.0.0.1:3000:3000"]
    mem_limit: 512m
    cpus: 0.5
    restart: unless-stopped
  bali-cafe:
    image: ghcr.io/jamot-pro/jamot-lite
    volumes: ["bali-cafe:/data"]
    ports: ["127.0.0.1:3001:3000"]
    mem_limit: 512m
    cpus: 0.5
    restart: unless-stopped
volumes: { restaurant: {}, bali-cafe: {} }
```

## What's proven, and what isn't

`pnpm isolation-check` (in CI) starts two companies from the bundle, refuses
a second start on one, kills one without warning and shows the other keeps
answering, then restarts the killed one over the lock it left behind.

- **Processes, memory, crashes:** independent — one dying doesn't touch the
  other.
- **Money:** each company has its own model key, its own run budget and its
  own web chat cap. One reaching its limit pauses only itself.
- **Disk:** *not* independent on one shared disk — one company filling it
  stops both. Give each company its own volume (as above) or a quota.
- **Network:** one machine, one network; a company can't read another's data
  without its password or MCP token.
