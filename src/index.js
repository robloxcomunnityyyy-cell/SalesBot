import 'dotenv/config.js';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import http from 'node:http';
import { resolve } from 'node:path';
import { getAllFreeDeals } from './deals.js';
import { loadNotified, saveNotified } from './notifiedStore.js';

const token = process.env.DISCORD_TOKEN;
const channelId = process.env.DISCORD_CHANNEL_ID;
const announceEveryone = process.env.ANNOUNCE_EVERYONE === 'true';
const checkIntervalMinutes = Number(process.env.CHECK_INTERVAL_MINUTES ?? 30);
const country = process.env.STEAM_COUNTRY ?? process.env.EPIC_COUNTRY ?? 'SK';
const epicCountry = process.env.EPIC_COUNTRY ?? country;
const steamCountry = process.env.STEAM_COUNTRY ?? country;
const locale = process.env.LOCALE ?? 'sk-SK';
const notifiedPath = resolve('data', 'notified.json');
const port = Number(process.env.PORT ?? 3000);

const status = {
  startedAt: new Date().toISOString(),
  loggedIn: false,
  botTag: null,
  lastCheckAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastDealCount: 0,
  lastNewDealCount: 0
};

if (!token) {
  throw new Error('Missing DISCORD_TOKEN in .env');
}

if (!channelId) {
  throw new Error('Missing DISCORD_CHANNEL_ID in .env');
}

if (!Number.isFinite(checkIntervalMinutes) || checkIntervalMinutes < 5) {
  throw new Error('CHECK_INTERVAL_MINUTES must be a number >= 5');
}

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('PORT must be a valid number');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/status') {
      sendJson(res, {
        ok: status.loggedIn && !status.lastError,
        ...status
      });
      return;
    }

    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('OK\n');
      return;
    }

    sendJson(res, { ok: false, error: 'Not found' }, 404);
  });

  server.listen(port, () => {
    console.log(`Health server listening on port ${port}`);
  });
}

async function announceDeal(channel, deal) {
  const mention = announceEveryone ? '@everyone ' : '';
  const message = `${mention}${deal.name} is now 100% free!\n${deal.platform}: ${deal.url}`;

  await channel.send({
    content: message,
    allowedMentions: announceEveryone ? { parse: ['everyone'] } : { parse: [] }
  });
}

async function checkAndAnnounce() {
  status.lastCheckAt = new Date().toISOString();
  status.lastError = null;

  const channel = await client.channels.fetch(channelId);

  if (!channel?.isTextBased()) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const notified = await loadNotified(notifiedPath);
  const { deals, errors } = await getAllFreeDeals({
    country,
    steamCountry,
    epicCountry,
    locale
  });

  status.lastDealCount = deals.length;

  for (const error of errors) {
    console.warn(error);
  }

  const newDeals = deals.filter((deal) => !notified.has(deal.id));
  status.lastNewDealCount = newDeals.length;

  if (newDeals.length === 0) {
    status.lastSuccessAt = new Date().toISOString();
    console.log(`[${new Date().toISOString()}] No new 100% free games found.`);
    return;
  }

  for (const deal of newDeals) {
    await announceDeal(channel, deal);
    notified.add(deal.id);
    console.log(`[${new Date().toISOString()}] Announced ${deal.platform}: ${deal.name}`);
  }

  await saveNotified(notifiedPath, notified);
  status.lastSuccessAt = new Date().toISOString();
}

async function runCheck(label) {
  try {
    await checkAndAnnounce();
  } catch (error) {
    status.lastError = error instanceof Error ? error.message : String(error);
    console.error(`${label} check failed:`, error);
  }
}

client.once(Events.ClientReady, () => {
  status.loggedIn = true;
  status.botTag = client.user.tag;
  console.log(`Logged in as ${client.user.tag}`);

  runCheck('Initial');

  setInterval(() => {
    runCheck('Scheduled');
  }, checkIntervalMinutes * 60 * 1000);
});

client.once('shardDisconnect', () => {
  status.loggedIn = false;
});

startHealthServer();
client.login(token);
