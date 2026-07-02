# Discord Free Games Bot

Discord bot that announces games that are currently 100% free on Steam or Epic Games.

Example message:

```text
@everyone Game Name is now 100% free!
Steam: https://store.steampowered.com/app/...
```

## Requirements

- Node.js 18 or newer
- Discord bot token
- Discord channel ID where the bot should post

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`.

3. Fill in:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CHANNEL_ID=your_channel_id
```

4. Keep `ANNOUNCE_EVERYONE=false` while testing. Change it to `true` only when you are sure the bot works.

5. Start the bot:

```bash
npm start
```

## Test store checks without Discord

This command checks Steam and Epic once and prints matching games:

```bash
npm run check
```

## Render Web Service

Use this if you want to keep the bot alive with an external ping service.

Render settings:

```text
Service Type: Web Service
Build Command: npm install
Start Command: npm start
```

Environment variables:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CHANNEL_ID=your_channel_id
ANNOUNCE_EVERYONE=false
CHECK_INTERVAL_MINUTES=30
STEAM_COUNTRY=SK
EPIC_COUNTRY=SK
LOCALE=sk-SK
```

Optional automatic Epic 100% discount source:

```env
ITAD_API_KEY=your_isthereanydeal_api_key
```

This enables IsThereAnyDeal's deals API as an extra source for Epic Games Store deals with `100%` discount. Register an app at `https://isthereanydeal.com/apps/` to get a key.

Optional manual Epic promo pages:

```env
EPIC_EXTRA_FREE_GAMES=Fell in love with coser 5|https://store.epicgames.com/p/fell-in-love-with-coser-5-514e7c
```

Use this only for Epic games that are visibly `-100%` on their store page but do not appear in Epic's weekly free games API. Separate multiple entries with semicolons.

Render sets `PORT` automatically, so you do not need to add it there.

Ping one of these URLs every few minutes:

```text
https://your-render-service.onrender.com/
https://your-render-service.onrender.com/health
```

To inspect the bot status in your browser, open:

```text
https://your-render-service.onrender.com/status
```

## Discord permissions

The bot needs permission to:

- view the target channel
- send messages
- mention `@everyone` if `ANNOUNCE_EVERYONE=true`

## Notes

- Already announced games are stored in `data/notified.json`.
- Steam and Epic availability can depend on country. The default country is `SK`.
- Steam free weekends or demos can sometimes look similar to 100% discounts, so this bot filters Steam entries where the discount is 100% and final price is 0.
