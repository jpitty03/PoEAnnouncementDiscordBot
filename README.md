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
