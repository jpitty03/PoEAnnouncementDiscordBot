# Path of Exile Discord Announcement Bot

Run your own Discord bot to post official Path of Exile news to a channel you choose. It checks for news every 10 minutes, remembers delivered announcements, and retries failed deliveries.

New installations create their configuration and history automatically.

## Set up your bot with Docker

You need a Discord server you can manage and Docker Desktop (Linux containers mode) or Docker Engine with the Compose plugin. Keep the host computer awake and Docker running while you want the bot online.

### 1. Create a Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Open **Bot**, generate a bot token, and save it for the next step.
3. Under **Privileged Gateway Intents**, enable **Message Content Intent** and save. The bot reads commands beginning with `!`.
4. On **Installation**, enable **Guild Install** and select **Discord Provided Link**. Under the Guild Install settings, add the `bot` scope and these permissions: **View Channels**, **Send Messages**, **Embed Links**, and **Read Message History**.
5. Open the install link and add the bot to your server. Ensure its role can access both the announcement channel and the channel where you will type commands.

See Discord's [application setup guide](https://docs.discord.com/developers/quick-start/getting-started#step-1-creating-an-app) and [intent documentation](https://docs.discord.com/developers/events/gateway#privileged-intents) for portal details.

### 2. Configure the project

Clone this repository and open a terminal in its folder. Copy `.env.example` to `.env`.

**PowerShell:**

```powershell
Copy-Item .env.example .env
notepad .env
```

**Linux or macOS:**

```sh
cp .env.example .env
```

Open `.env` in a text editor and replace the placeholder with your bot token:

```dotenv
BOT_TOKEN=your_discord_bot_token
```

Only the token needs to change for a default setup. Keep `.env` private; it is excluded from Git and the Docker image.

### 3. Start the bot

```sh
docker compose up -d --build
docker compose logs --tail=100 -f bot
```

Wait for `Logged in as ...; news source: rss.` Press Ctrl+C to close the log viewer; the container continues running. Node.js is included in the image.

### 4. Choose your announcement channel

In a server channel the bot can read, run:

```text
!setpoechannel #game-news
!poenewsstatus
```

Replace `#game-news` with your channel and select the actual channel mention in Discord. Your Discord account needs **Manage Channels**, **Manage Messages**, **Kick Members**, or **Administrator**.

By default, the bot records existing feed entries and waits for new announcements. To post the latest announcement immediately:

```text
!postpoenews latest
```

Your server configuration and delivery history are saved in a Docker volume and survive container rebuilds.

## What gets posted?

The default source is [GGG's official news feed](https://www.pathofexile.com/news/rss): game announcements, events, community news, and store promotions. It can include news for both Path of Exile games.

You can instead select GGG's Steam announcements for PoE 1, PoE 2, or both. Optional X posts require an RSS provider you supply. See [news sources and configuration](docs/configuration.md).

## Commands

Run these in your server using one of the moderator permissions listed above.

| Command | Action |
| --- | --- |
| `!setpoechannel #channel` | Choose the announcement channel. |
| `!setpoetag <text or role mention>` | Set text or a role mention to include with news. |
| `!setpoetag clear` | Remove the tag. |
| `!poenewsstatus` | Show the channel, feed health, and pending deliveries. |
| `!postpoenews latest` | Post the latest news now. |
| `!postpoenews <announcement URL>` | Post a saved announcement or one in the current feed. |
| `!togglex` | Toggle X posts for this server; requires `X_RSS_URL`. |
| `!unsetpoechannel` | Stop announcements for this server. |
| `!poenewshelp` | Show command help. |

Manual posting targets the current server and skips announcements already delivered there.

## Logs and updates

View logs any time from the repository folder:

```sh
docker compose logs --tail=100 -f bot
```

To update:

```sh
git pull
docker compose build --pull
docker compose up -d
```

Keep your existing `.env` when updating. See [operations and troubleshooting](docs/operations.md) for stopping the bot, applying settings, backups, and common errors.

## Run without Docker

Complete the Discord bot and `.env` setup above, then use Node.js 24 or Node.js 22.13+ in the 22 release line:

```sh
npm ci
npm start
```

Choose the channel with `!setpoechannel` as above. The example configuration stores local data in `data/`. Leave the terminal running, or use a process manager for unattended hosting.

## Development

```sh
npm ci
npm run check
npm run check:feeds
```

`check` runs ESLint and offline tests. `check:feeds` checks the configured news source without logging in to Discord or posting messages. GitHub Actions checks Windows and Linux with Node.js 22 and 24.

## License

[MIT](LICENSE). Not affiliated with or endorsed by Grinding Gear Games.
