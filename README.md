# Path of Exile Discord Announcement Bot

Posts Path of Exile announcements to configured Discord servers, with persistent delivery tracking, retries, and optional X posts.

[Invite the hosted bot](https://discord.com/oauth2/authorize?client_id=1336092556987207791&scope=bot%20applications.commands&permissions=0), or follow the self-hosting instructions below. For support, contact IceTown on Discord or visit the [support server](https://discord.gg/DcstwdqbGP).

## News sources

| Setting | Source | Coverage |
| --- | --- | --- |
| `NEWS_SOURCE=rss` (default) | [GGG's official RSS feed](https://www.pathofexile.com/news/rss), linked from the [official news page](https://www.pathofexile.com/news) | Website news, including announcements for both games. The parser handles bare ampersands found in this feed. |
| `NEWS_SOURCE=steam` | [Steam's documented news API](https://partner.steamgames.com/doc/webapi/ISteamNews) | GGG's publisher announcements for selected games. Results are filtered to `steam_community_announcements`, excluding press feeds. No Steam API key is needed. |
| `X_RSS_URL=...` (optional) | An operator-provided RSS feed for the Path of Exile X account | Independent of news delivery and opt-in per server. No public Nitter instance is hardcoded. |

Steam is a useful alternative when access to the website feed is unreliable. It has a structured JSON response, but the announcements and publication times can differ from the website feed. Source selection is explicit; the bot does not switch between overlapping feeds automatically.

To use Steam for PoE 1, add this to your existing `.env`:

```dotenv
NEWS_SOURCE=steam
STEAM_APP_IDS=238960
```

Use `2694490` for PoE 2, or `238960,2694490` for both. Each game has its own feed and delivery history. A shared announcement published to both games can appear twice when both are selected.

## Run locally

Use Node.js 24, or Node.js 22.13 or newer in the 22 release line.

1. Install the locked dependencies with `npm ci`.
2. For a new installation, copy `.env.example` to `.env` and set `BOT_TOKEN`. Keep an existing `.env` when upgrading.
3. Enable **Message Content Intent** for your bot in the Discord Developer Portal. The bot uses prefix commands; see [Discord's intent documentation](https://docs.discord.com/developers/events/gateway#privileged-intents).
4. Invite the bot and grant **View Channel**, **Send Messages**, and **Embed Links** in the announcement channel. Also allow **Read Message History** where moderators use commands and receive replies.
5. Run `npm start`, then use `!setpoechannel #news` in your server.

The token is loaded from the `.env` beside `bot.js`, independent of the shell's working directory.

On first use of each source, the default `FIRST_RUN_MODE=baseline` records its existing feed without posting it. Future entries are posted normally. Set `FIRST_RUN_MODE=backfill` before first use to deliver unseen entries already in the feed. Restarting with an existing delivery history resumes it; changing this setting does not replay entries already recorded.

For an existing bot, stop the old process before starting this version. Keep `guild_channels.json`, `posted_news.json`, and `posted_x_news.json` in the configured data directory. Legacy announcement history remains read-only and suppresses old posts. Because the old format tracked posts globally, it cannot identify which individual servers missed historical announcements.

## Run with Docker on another computer

Use Docker Desktop in **Linux containers** mode on Windows/macOS, or Docker Engine with the Compose plugin on Linux. The computer must stay awake with Docker running for the bot to stay online. Node.js and npm are included in the image; you do not need to install them on the host.

First commit and push the Docker files and this guide from the development computer. On the other computer, clone that commit (or run `git pull` in an existing clone), open a terminal in the repository, and follow these steps.

1. Create `.env` from `.env.example`. In PowerShell:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   On Linux/macOS, use `cp .env.example .env` and your preferred editor. Replace `your_discord_bot_token` with your bot's token, or privately copy your existing `.env` from the original computer to keep its settings. Preserve an existing `.env` instead of overwriting it. Leave `NEWS_SOURCE=rss` and `FIRST_RUN_MODE=baseline` unless you intentionally want different behavior. Compose sets `DATA_DIR=/data/state` inside the container regardless of the value in `.env`.

2. **If moving the existing bot**, stop it on the original computer and transfer its data using the migration instructions below **before starting the new container**. Running the same bot on two computers with separate histories can send duplicate announcements. For a brand-new bot with no history to keep, continue to step 3.

3. Build and start the bot in the background:

   ```sh
   docker compose up -d --build
   ```

4. Check startup:

   ```sh
   docker compose ps
   docker compose logs --tail=50 -f bot
   ```

   Look for `Logged in as ...; news source: rss.` Ctrl+C exits the log viewer; the container keeps running. On a new installation, no server is configured until the next step.

5. In a Discord channel the bot can access, run these as a moderator:

   ```text
   !setpoechannel #game-news
   !poenewsstatus
   ```

   Select the actual channel mention when typing `#game-news`. Enable Message Content Intent in the Discord Developer Portal and grant the channel permissions listed under **Run locally**. Existing migrated subscriptions keep their channels. The initial feed is baselined, so use `!postpoenews latest` if you want an announcement immediately.

The container runs as the unprivileged `node` user, restarts automatically unless explicitly stopped, and gets 45 seconds to shut down cleanly. It needs outbound internet access to Discord and the news feed; no inbound port or router forwarding is required. Log rotation limits each container to three 10 MB log files. `.env`, local history, and the Git checkout are excluded from the image.

### Transfer the existing bot and its history

Transfer `.env` privately as described above; it is not part of the data backup. Keep the original bot stopped after the move.

**From a Docker installation**, run on the original computer:

```sh
docker compose stop bot
docker compose cp bot:/data/state ./bot-data-transfer
```

Use a new `bot-data-transfer` directory for each export. Copy that directory to the root of the clone on the other computer. The directory should directly contain `guild_channels.json`, `delivery_state.json`, and any legacy `posted_news.json`, `posted_x_news.json`, or `.bak` files.

**From a local `node bot.js` installation**, stop it with Ctrl+C, then copy those same files from its configured `DATA_DIR` into `bot-data-transfer` on the other computer. With the default configuration, the files are in the original project root. Transfer the current files, not an older copy from Git.

On the destination computer, import before the first `docker compose up`:

```sh
docker compose build --pull
docker compose run --rm --no-deps --volume "${PWD}/bot-data-transfer:/import:ro" bot node scripts/import-data.js /import /data/state
docker compose up -d
```

`${PWD}` works in PowerShell and Linux/macOS shells. The importer validates the history, copies only the four bot data files and their backups, preserves the source, and refuses to overwrite an existing destination or import from an active bot. A failed validation leaves the destination unpublished. It does not log in to Discord or send announcements.

For a first migration into Docker on the **same** computer, you can mount the stopped local bot's existing data directory directly instead of making a transfer folder. If its data is in the current project root:

```sh
docker compose build --pull
docker compose run --rm --no-deps --volume "${PWD}:/import:ro" bot node scripts/import-data.js /import /data/state
docker compose up -d
```

### Manage the Docker bot

| Task | Command |
| --- | --- |
| View status | `docker compose ps` |
| View logs | `docker compose logs --tail=50 -f bot` |
| Stop | `docker compose stop bot` |
| Start again | `docker compose up -d` |
| Apply `.env` changes | `docker compose up -d --force-recreate` |
| Update code and the Node image | `git pull`, then `docker compose build --pull`, then `docker compose up -d` |
| Check the feed without posting | `docker compose run --rm --no-deps bot node scripts/check-feeds.js` |

Current server configuration and delivery history live in the named volume **`poe-news-bot_bot-data`**, under `/data/state` in the container. The old files in the checkout stop being the active state after import. Back up the volume using the stop-and-copy procedure above. Ordinary rebuilds and `docker compose down` retain it; `docker compose down --volumes` deletes it. A Git clone does not include this volume or `.env`.

On Docker Desktop, enable startup when you sign in if you want the container to return automatically after a reboot. An intentionally stopped container stays stopped until you start it again. Docker behavior is documented in the [Compose service reference](https://docs.docker.com/reference/compose-file/services/) and [volume guide](https://docs.docker.com/engine/storage/volumes/).

## Moderator commands

A moderator needs at least one of **Administrator**, **Manage Channels**, **Manage Messages**, or **Kick Members**. Commands from bots, direct messages, and unauthorized members are ignored.

| Command | Action |
| --- | --- |
| `!setpoechannel #channel` | Select a text or announcement channel in this server. The bot checks its permissions before saving. |
| `!setpoetag <tag>` | Set a prefix, actual role mention, or `@everyone` for news announcements; maximum 500 characters. |
| `!setpoetag clear` | Remove the prefix. |
| `!togglex` | Toggle X posts. Enabling requires the bot operator to configure `X_RSS_URL`. |
| `!poenewsstatus` | Show the channel, tag, source health, pending deliveries, and recent delivery errors for this server. |
| `!postpoenews latest` | Send the newest announcement from the selected news source to this server now, even if it predates the subscription. |
| `!postpoenews <announcement URL>` | Send one saved or current-feed announcement to this server, including entries skipped at startup. |
| `!unsetpoechannel` | Stop this server's subscriptions. |
| `!poenewshelp` | Show command help. |

Command replies do not trigger mentions. Announcement mentions are limited to those explicitly included in the moderator's tag, and Discord's permission rules still apply. X posts retain their link-only format.

New subscriptions receive future announcements; dated entries older than the subscription are skipped. Explicit backfill on a source's first run overrides that date cutoff. Changing an existing channel preserves delivery history and directs pending posts to the new channel. Unsubscribing cancels pending deliveries when the queue is next processed.

To test delivery or post an older announcement, use `!postpoenews latest` or supply its URL. These commands target only the server where you run them, use that server's configured channel and tag, and keep the result in delivery history. An announcement already delivered to that server is not sent again. Failed explicit deliveries remain queued for automatic retry. A saved URL works even when the source feed is unavailable; other URLs are looked up only in the configured news feed.

Deleting an announcement's history does not override the subscription date or startup baseline rules. `FIRST_RUN_MODE=backfill` applies only to a source that has never been initialized; it does not replay an existing source's history. New skipped records include `skipReason`, such as `startup_baseline` or `before_subscription`.

The `deliveries` section is a history of recipients when an article was discovered. Old server IDs can remain there after removal from `guild_channels.json`; those historical entries are not active subscriptions. To remove a server by editing the configuration file, stop the bot, edit `guild_channels.json`, then restart so it loads the change. Use the command above to send an old article to a newly subscribed server without deleting history.

## Configuration

All settings except `BOT_TOKEN` are optional. See [.env.example](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_TOKEN` | Required | Discord bot token. |
| `NEWS_SOURCE` | `rss` | `rss` or `steam`. |
| `RSS_FEED_URL` | Official PoE RSS URL | RSS source when using RSS mode. |
| `STEAM_APP_IDS` | `238960` | PoE 1, PoE 2, or both, as described above. |
| `X_RSS_URL` | Empty | X RSS provider. Leaving it empty disables X fetching while preserving server preferences. |
| `DATA_DIR` | Project directory | Persistent data directory. Relative paths resolve against the project. |
| `POLL_INTERVAL_MS` | `600000` | Delay after a completed poll, all day; 10 minutes by default. |
| `HTTP_TIMEOUT_MS` | `30000` | Per-attempt timeout covering both headers and response body. |
| `HTTP_MAX_ATTEMPTS` | `3` | Total attempts for transient HTTP failures. |
| `HTTP_MAX_BYTES` | `2097152` | Maximum response size, including streamed bodies. |
| `FIRST_RUN_MODE` | `baseline` | Skip current feed entries on first use, or choose `backfill`. |
| `HISTORY_LIMIT` | `1000` | Completed records retained per source, plus current feed entries and all pending deliveries. |

Invalid settings stop startup with an explanatory error. Restart the bot after editing `.env`.

## Delivery and recovery

- Each announcement is identified by a normalized URL, Steam ID, or X status ID, so different announcements sharing a publication date are not lost.
- The bot saves recipients and announcement content to `delivery_state.json` **before sending**, then saves each server's acknowledgement immediately after success.
- Failed servers retain their queued posts across restarts and feed outages, including posts that have disappeared from the source feed. Successful servers are skipped on subsequent attempts.
- Sources run independently. Within each source, posts are delivered oldest first per server. A failed delivery pauses that server's queue until the next poll.
- Polls never overlap. HTTP requests have bounded bodies and timeouts, transient failures use backoff, and rate-limit cooldowns respect `Retry-After`.
- A lock inside `DATA_DIR` prevents two instances from sharing that data concurrently. After a forced termination, allow about 30 seconds for the abandoned lock to expire before restarting.
- Ctrl+C and termination signals stop polling, cancel feed requests, finish active sends, save acknowledgements, and disconnect. Unexpected exceptions or persistence failures stop the bot so a process supervisor can restart it safely.

JSON writes use a temporary file, flush it, and rename it into place. Each existing file's previous version is retained as `.bak`. Damaged JSON or an invalid delivery schema stops startup without overwriting the original. Invalid individual guild entries are logged and ignored while remaining in the configuration file.

To recover a damaged file, stop the bot, preserve the damaged file, then repair it or restore a known-good backup. Restoring older delivery history can replay posts sent since the backup. Do not delete history to resolve a parsing error or edit state while the bot is running. Use persistent storage for `DATA_DIR` and run a single instance for a given bot deployment.

There is a small duplication window if Discord accepts a message and the process dies before its acknowledgement reaches disk. Deterministic nonces use [Discord's recent-message deduplication](https://discord.js.org/docs/packages/discord.js/main/MessageCreateOptions:Interface); this is not an unlimited exactly-once guarantee. Very old feed entries returning after their completed records were pruned can also be treated as new.

Changing news sources keeps each source's history separately. Pending work for a disabled source stays saved and resumes if that source is selected again.

## Checks and development

```sh
npm run check
npm audit
npm run check:feeds
node scripts/check-feeds.js --all
```

`npm run check` runs ESLint and offline tests covering retries, stalled HTTP bodies, malformed feeds, configuration, permissions, delivery persistence, source isolation, locking, and shutdown. Tests use temporary directories and simulated Discord clients.

The feed diagnostics fetch and parse the selected source, or all three news feeds with `--all`. They do not log into Discord, post messages, or write bot state. Optional X is included only when configured.

GitHub Actions runs the offline checks on Windows and Linux with Node.js 22 and 24.

## License

[MIT](LICENSE). This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
