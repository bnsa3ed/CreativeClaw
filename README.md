# CreativeClaw 🎬

**Control Premiere Pro, After Effects, Photoshop, and Illustrator from Telegram — with plain English.**

Type *"trim the intro clip from 5 to 30 seconds"* in Telegram. CreativeClaw figures out what you mean, fires the right Adobe operation, and sends you the result. No scripting. No plugins to click through. Just talk to your apps.

---

## What you can do

```
"trim clip intro from 5s to 30s"
"export the current sequence to my desktop"
"apply LUT FilmLook.cube to the background layer"
"resize to 1920x1080"
"render the active comp and send me the file"
"replace text Draft with Final"
"delete the lower thirds layer"
```

All of these go through Telegram. You can also run them from the CLI or schedule them to run automatically at any time.

---

## Install

> Requires: macOS or Linux · Node.js 22+ · Git

```bash
curl -fsSL https://raw.githubusercontent.com/bnsa3ed/CreativeClaw/main/scripts/install.sh | bash
```

That's it. The script installs everything and launches the setup wizard automatically.

---

## Setup (2 minutes)

The setup wizard asks you three things:

**1. Telegram Bot Token**
- Open Telegram → message **@BotFather** → `/newbot`
- Follow the steps → copy the token it gives you

**2. Your Telegram User ID**
- Message **@userinfobot** on Telegram
- It replies with your numeric ID (e.g. `5238367056`)

**3. Anthropic API Key** *(optional but recommended)*
- Get one at [console.anthropic.com](https://console.anthropic.com)
- Without it, only basic keyword matching works

```
  ── Step 1 of 4: Telegram Bot ──────────────
  Telegram Bot Token: ••••••••••••••••••••••••

  ── Step 2 of 4: Your Telegram ID ──────────
  Your Telegram User ID: 5238367056

  ── Step 3 of 4: AI / NLP (Optional) ──────
  Anthropic API Key (press Enter to skip): ••••••••

  ── Step 4 of 4: Gateway Settings ──────────
  Gateway port [3789]:
  Enable Adobe mock mode? (y/N) n

  ✓ .env saved
  ✓ Bot verified: @MyBot
  ✓ Gateway started on port 3789
  ✓ API key generated and saved
  ✓ Adobe worker started

  ✅ Setup complete!
```

Now open Telegram and message your bot `/start`.

---

## Telegram Commands

| Command | What it does |
|---|---|
| `/start` | Introduction + quick start tips |
| `/help` | All available commands |
| `/status` | Is the gateway online? How many workers? |
| `/workers` | Which machines are connected with Adobe open |
| `/jobs` | Your recent job history |
| `/assets` | What's currently open in Premiere / AE / PS / Illustrator |
| `/approve <id>` | Approve a high-risk operation (delete, export) |
| `/clear` | Reset conversation memory |
| *(any text)* | Natural language — parsed by Claude and executed |

### High-risk operations need your approval

Some operations are destructive (deleting clips, exporting files). CreativeClaw pauses and asks before running them:

```
⚠️ Approval required
Op: delete_clip (premiere)
Risk: HIGH
ID: a1b2c3-...

Reply /approve a1b2c3 to confirm.
```

Type `/approve a1b2c3` to proceed, or ignore it to cancel.

---

## Supported Adobe Operations

### Premiere Pro
| Operation | What it does | Example phrase |
|---|---|---|
| `trim_clip` | Set in/out points on a clip | *"trim intro from 5 to 30 seconds"* |
| `insert_clip` | Insert an asset at a timecode | *"insert B-roll.mp4 at 1 minute"* |
| `delete_clip` | Remove a clip from sequence ⚠️ | *"delete the lower thirds clip"* |
| `export_sequence` | Export active sequence to file | *"export to /Desktop/final.mp4"* |

### After Effects
| Operation | What it does | Example phrase |
|---|---|---|
| `add_keyframe` | Add keyframe to a layer property | *"add keyframe on opacity at 2s"* |
| `render_comp` | Render the active composition | *"render the main comp"* |
| `delete_layer` | Delete a layer ⚠️ | *"delete the background layer"* |

### Photoshop
| Operation | What it does | Example phrase |
|---|---|---|
| `apply_lut` | Apply a LUT to a layer | *"apply LUT FilmLook to background"* |
| `apply_curves` | Adjust curves on a channel | *"add contrast to the RGB channel"* |
| `resize` | Resize the document | *"resize to 1920 by 1080"* |
| `export` | Export as image file | *"export as JPEG to /Desktop/hero.jpg"* |

### Illustrator
| Operation | What it does | Example phrase |
|---|---|---|
| `replace_text` | Replace text in a text object | *"change Draft to Final Version"* |
| `export` | Export as PDF/SVG/PNG | *"export as PDF to /Desktop/logo.pdf"* |

> ⚠️ = requires approval before executing

---

## CLI

After setup, `creativeclaw` is available globally:

```bash
# Check everything is working
creativeclaw doctor

# Run a natural language command
creativeclaw run "trim the intro clip from 5 to 30 seconds"

# Execute an operation directly
creativeclaw execute premiere trim_clip \
  --payload '{"clipId":"intro","in":"5","out":"30"}'

# See what's open in Adobe
creativeclaw assets

# Worker management
creativeclaw worker status    # is the local worker running?
creativeclaw worker start     # start it in the background
creativeclaw worker stop      # stop it
creativeclaw worker logs      # tail the worker log

# Job history
creativeclaw jobs history

# Schedule a recurring operation
creativeclaw schedule add \
  --label "Nightly export" \
  --kind cron \
  --expr "0 2 * * *" \
  --app premiere \
  --op export_sequence \
  --payload '{"outputPath":"/exports/nightly.mp4"}'

# Team management
creativeclaw team
creativeclaw team add --user 123456 --role reviewer

# API key management
creativeclaw auth keys
creativeclaw auth keys add --label "studio-laptop"
creativeclaw auth keys revoke <id>
```

---

## Dashboard

A live web dashboard is available at **http://127.0.0.1:3790** — auto-refreshes every 5 seconds.

Shows: connected workers, pending approvals, job history, scheduled jobs, API keys, open Adobe assets, operation log, and Prometheus metrics.

---

## Schedule operations automatically

Run Adobe operations on a schedule — no cron job needed:

```bash
# Export every weeknight at 2 AM
creativeclaw schedule add \
  --label "Nightly export" \
  --kind cron \
  --expr "0 2 * * 1-5" \
  --app premiere \
  --op export_sequence \
  --payload '{"outputPath":"/exports/latest.mp4"}'

# Check every 30 minutes
creativeclaw schedule add \
  --label "Render poll" \
  --kind interval \
  --expr "1800000" \
  --app aftereffects \
  --op render_comp \
  --payload '{"outputPath":"/renders/latest.mp4"}' \
  --webhook https://my-server.com/done
```

Add a `--webhook` URL to get a POST callback when each run completes.

---

## Team setup

Add colleagues so they can control Adobe apps too:

```bash
# Give someone reviewer access (can approve high-risk ops)
creativeclaw team add --user 987654321 --role reviewer

# Give someone editor access (can execute ops, can't approve)
creativeclaw team add --user 111222333 --role editor
```

| Role | Run operations | Approve high-risk | Manage team |
|---|---|---|---|
| `owner` | ✅ | ✅ | ✅ |
| `reviewer` | ✅ | ✅ | — |
| `editor` | ✅ | — | — |
| `viewer` | — | — | — |

The person who ran setup is automatically the `owner`.

---

## Update

```bash
creativeclaw update
```

Pulls the latest code, rebuilds, and restarts the gateway and worker. Your data (API keys, jobs, memory, team) is never touched.

```
  ── What stays safe ─────────────────────────
  ✓ ~/.creativeclaw/   (all your data)
  ✓ .env               (your tokens + config)

  ── What gets updated ───────────────────────
  ↑ Source code + dependencies + build
```

Use `--dry-run` to preview what would change without touching anything.

---

## Adobe CEP Panel (optional — adds Windows support)

The default worker uses macOS-only `osascript`. For Windows, or if you want a panel inside Adobe itself:

```bash
bash scripts/install-cep.sh
```

This downloads the real Adobe CSInterface.js, installs the panel to the right location, and enables unsigned extensions. Then: **Window → Extensions → CreativeClaw** inside any Adobe CC app.

---

## Environment Variables

| Variable | Required | What it does |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Your bot token from @BotFather |
| `CREATIVECLAW_OWNER_ID` | ✅ | Your Telegram user ID — seeded as initial owner |
| `ANTHROPIC_API_KEY` | Recommended | Enables natural language via Claude. Without it, only keyword matching. |
| `CREATIVECLAW_API_KEY` | Auto-generated | Master API key. Created automatically on first run. |
| `CREATIVECLAW_ADOBE_MOCK` | — | `true` = simulate Adobe without the real apps (safe for testing) |
| `CREATIVECLAW_PUBLIC_URL` | — | Your public server URL — enables Telegram webhook mode instead of polling |
| `WORKER_TIMEOUT_MS` | — | How long to wait for Adobe to finish (default: 600000 = 10 min) |
| `CORS_ORIGIN` | — | Lock dashboard CORS to a specific URL in production (default: `*`) |
| `GATEWAY_PORT` | — | Gateway port (default: 3789) |

All variables are set by the setup wizard. Edit `.env` to change them later.

---

## Troubleshooting

**Bot doesn't respond in Telegram**
```bash
creativeclaw doctor    # shows exactly what's wrong
creativeclaw worker status
```

**"No worker connected" error**
```bash
creativeclaw worker start
```
The local worker must be running on a Mac with the Adobe app open.

**Operations time out**
Long operations like renders can exceed the default timeout. Increase it in `.env`:
```bash
WORKER_TIMEOUT_MS=1800000   # 30 minutes
```

**Re-run setup**
```bash
creativeclaw setup
```
Safe to run any time — it detects your existing `.env` and only updates what you change.

**Check logs**
```bash
creativeclaw worker logs              # Adobe worker log
tail -f ~/.creativeclaw/worker.log    # same, raw
```

---

## Deploy to a server

### Docker
```bash
cp .env.example .env   # fill in your values
docker compose up -d
```

### Fly.io
```bash
fly launch
fly secrets set TELEGRAM_BOT_TOKEN=... CREATIVECLAW_OWNER_ID=... ANTHROPIC_API_KEY=...
fly deploy
```

### Linux systemd
```bash
sudo cp systemd/creativeclaw-gateway.service /etc/systemd/system/
sudo systemctl enable --now creativeclaw-gateway
sudo journalctl -u creativeclaw-gateway -f
```

> When deploying to a server, set `CREATIVECLAW_PUBLIC_URL` to your server's URL so the bot uses webhook mode instead of polling.

---

## How it works (briefly)

```
You (Telegram)
    ↓
Telegram Bot (polling or webhook)
    ↓
NLP Router (Claude parses your message → finds the right operation)
    ↓
Gateway (authenticates, checks risk, queues approval if needed)
    ↓
Local Worker (on your Mac, connected via WebSocket)
    ↓
Adobe App (ExtendScript executed inside Premiere / AE / PS / AI)
    ↓
Result back to you in Telegram
```

---

## License

MIT
