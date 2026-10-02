# Operations and troubleshooting

[Back to setup](../README.md) · [Configuration](configuration.md)

## Docker commands

Run these from the repository folder.

| Task | Command |
| --- | --- |
| Start | `docker compose up -d` |
| Check status | `docker compose ps` |
| Follow logs | `docker compose logs --tail=100 -f bot` |
| Stop | `docker compose stop bot` |
| Apply `.env` changes | `docker compose up -d --force-recreate` |
| Update code and image | `git pull`, then `docker compose build --pull`, then `docker compose up -d` |
| Check the feed without posting | `docker compose run --rm --no-deps bot node scripts/check-feeds.js` |

Ctrl+C closes the log viewer while the container keeps running. The container restarts automatically unless explicitly stopped. Keep Docker running and the host awake; on Docker Desktop, enable startup at sign-in if desired. No inbound port or router forwarding is required.

Compose gives the bot 45 seconds to finish outstanding sends and save acknowledgements during shutdown. It runs as the unprivileged `node` user with a read-only application filesystem. Logs rotate at 10 MB, with three files retained.

## Data and backups

New installations create their own data files. They are excluded from Git and the Docker image.

| Installation | Active data location |
| --- | --- |
| Docker Compose | `/data/state` inside the `poe-news-bot_bot-data` volume |
| Local Node.js using `.env.example` | `data/` in the repository |
| Local Node.js with `DATA_DIR` unset | Repository root, for compatibility with older installs |

`guild_channels.json` stores server settings. `delivery_state.json` stores source status and per-server delivery history. Older `posted_news.json` and `posted_x_news.json` files are read when present to suppress previously handled posts.

Back up the whole active data directory with the bot stopped, including any `.bak` files, and keep `.env` separately. Docker volume data survives container rebuilds and `docker compose down`. Adding `--volumes` to `down` deletes that data. See Docker's [volume backup documentation](https://docs.docker.com/engine/storage/volumes/#back-up-restore-or-migrate-data-volumes) for storage management.

Run one instance for a given bot token. The data-directory lock prevents two processes from sharing the same directory, but separate computers or volumes have independent histories.

**Older local checkouts:** previous versions tracked server settings and legacy history in Git. Before updating one of those installations, stop the bot and back up its data outside the checkout; Git can remove formerly tracked files during the update. Restore your data into the configured `DATA_DIR` before starting. Existing Docker data lives in its volume.

## Common issues

| Symptom | What to check |
| --- | --- |
| Docker cannot connect to its engine | Start Docker Desktop or Docker Engine. On Windows, use Linux containers. |
| Missing `.env` or `BOT_TOKEN` error | Create `.env` from `.env.example` and set your bot token. |
| Bot does not respond to commands | Enable Message Content Intent; type in a server channel the bot can view and reply in; use one of the moderator permissions in the README. |
| `!setpoechannel` rejects a channel | Select an actual channel mention in the same server. The destination must be a text or announcement channel. |
| `Missing Access` or `Missing Permissions` | Check the bot's channel access, including role/category overrides. It needs View Channel, Send Messages, and Embed Links; also allow Read Message History where it replies to commands. |
| Bot is online but nothing posts | Run `!poenewsstatus` to check the subscription and feed. Existing entries are baselined by default; use `!postpoenews latest` for an immediate post. |
| An announcement says `skipped` | It may belong to the startup baseline or predate the server's subscription. Use the manual posting command for an older item. |
| State file is invalid | Stop the bot, preserve the damaged file, and repair it or restore a known-good backup. |
| Data directory is locked | Stop the other instance. Following a forced termination, allow about 30 seconds for a stale lock to expire. |

For local Node.js installs, feed diagnostics are available with `npm run check:feeds`. Use `node scripts/check-feeds.js --all` to check official RSS and both Steam feeds. These diagnostics do not log into Discord, post messages, or change bot state.

## Delivery and recovery

The bot saves pending deliveries before sending, then saves each Discord acknowledgement after success. Failed deliveries remain queued across restarts and feed outages. Sources run independently; a failing server pauses its own queue while other servers continue. Polls do not overlap, requests have size/time limits, and transient failures respect retry delays.

JSON updates use atomic replacement and keep the previous version as `.bak`. Invalid state or a write failure stops the bot to protect its history. Restore a consistent, known-good backup while stopped; older backups can replay posts sent after they were taken. Use moderator commands for configuration instead of editing files while the bot runs.

Removing a subscription cancels its pending deliveries while preserving historical records. Only currently configured servers receive posts. Changing a channel preserves delivery history and sends pending posts to the new destination.

A process can stop after Discord accepts a message but before its acknowledgement is saved. Deterministic nonces help with [recent-message deduplication](https://discord.js.org/docs/packages/discord.js/main/MessageCreateOptions:Interface), but do not guarantee unlimited duplicate prevention. Very old entries that return after their completed records were pruned can also be treated as new.
