# Configuration

[Back to setup](../README.md)

Settings are read from `.env` in the project root. Only `BOT_TOKEN` is required. Keep an existing `.env` when upgrading; `.env.example` is a starting point for new installations.

After editing `.env`, apply it with `docker compose up -d --force-recreate`, or restart the local Node.js process.

## News sources

### Official RSS (default)

```dotenv
NEWS_SOURCE=rss
```

Uses [GGG's official RSS feed](https://www.pathofexile.com/news/rss), linked from its [news page](https://www.pathofexile.com/news). Coverage follows the website and can include either game, community posts, events, and promotions.

### Steam

```dotenv
NEWS_SOURCE=steam
STEAM_APP_IDS=238960
```

Uses [Steam's news API](https://partner.steamgames.com/doc/webapi/ISteamNews), filtered to GGG's publisher announcements. No Steam API key is needed.

| `STEAM_APP_IDS` | Games |
| --- | --- |
| `238960` | Path of Exile 1 |
| `2694490` | Path of Exile 2 |
| `238960,2694490` | Both |

Steam coverage and publication times can differ from the website. Each game's feed has separate history; a shared announcement published to both games can appear twice when both are selected. The bot uses the source you choose and does not automatically switch providers.

### Optional X posts

Set `X_RSS_URL` to an RSS feed for the Path of Exile X account, then run `!togglex` in each server that wants it. You must supply the provider. Leave this setting empty to use news only. X posts are sent as links.

## Settings reference

Defaults below apply when a setting is absent. The example file sets `DATA_DIR=./data` for local installs; Docker Compose always sets it to `/data/state` in the persistent volume.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_TOKEN` | Required | Your Discord bot token. |
| `NEWS_SOURCE` | `rss` | `rss` or `steam`. |
| `RSS_FEED_URL` | `https://www.pathofexile.com/news/rss` | Feed used in RSS mode. |
| `STEAM_APP_IDS` | `238960` | One or both game IDs above, separated by a comma. |
| `X_RSS_URL` | Empty | Optional X RSS provider. |
| `DATA_DIR` | Project root | Persistent data location; relative paths resolve against the project. |
| `POLL_INTERVAL_MS` | `600000` | Delay after each completed check; 10 minutes. |
| `HTTP_TIMEOUT_MS` | `30000` | Per-attempt timeout, including response body. |
| `HTTP_MAX_ATTEMPTS` | `3` | Total attempts for transient HTTP failures. |
| `HTTP_MAX_BYTES` | `2097152` | Maximum response size; 2 MiB. |
| `FIRST_RUN_MODE` | `baseline` | `baseline` or `backfill`, explained below. |
| `HISTORY_LIMIT` | `1000` | Completed records retained per source, plus current feed entries and all pending deliveries. |

Invalid settings stop startup with an explanatory error.

## First run and existing announcements

`FIRST_RUN_MODE=baseline` records the source's existing entries without posting them. Newly subscribed servers receive future announcements; dated entries older than their subscription are skipped.

Use `!postpoenews latest` or `!postpoenews <announcement URL>` to send one existing announcement deliberately. This uses the current server's configured channel and tag, records the result, and retries a failed delivery. Already delivered announcements are skipped. Saved URLs work during feed outages; other URLs must match an item in the configured news feed.

Set `FIRST_RUN_MODE=backfill` before a source's first use to send its unseen existing entries. Once that source has been initialized, changing this setting does not replay its history. Deleting individual records also does not override subscription dates.

Changing sources keeps their histories separately. Pending deliveries from a disabled source resume if you select it again.

## Tags and mentions

`!setpoetag` accepts up to 500 characters. Use an actual Discord role mention if you want a role notified, and grant the bot permission to mention that role. News messages allow only mentions configured in the tag; command replies do not ping users or roles. Use `!setpoetag clear` to remove the tag.
