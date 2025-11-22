const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');

// ------------- CONFIG (from environment variables) -------------
const TOKEN = process.env.DISCORD_TOKEN;
const CACHE_CHANNEL_ID = process.env.CACHE_CHANNEL_ID;
const WATCH_CHANNEL_ID = process.env.WATCH_CHANNEL_ID;
const SECURITY_WEBHOOK = process.env.SECURITY_WEBHOOK;
// ---------------------------------------------------------------

if (!TOKEN || !CACHE_CHANNEL_ID || !WATCH_CHANNEL_ID || !SECURITY_WEBHOOK) {
  console.error("❌ Missing required environment variables.");
  console.error("Expected: DISCORD_TOKEN, CACHE_CHANNEL_ID, WATCH_CHANNEL_ID, SECURITY_WEBHOOK");
  process.exit(1);
}

const client = new Client();
const cachedUsers = new Set();
let cacheReady = false;

client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log("Loading ALL messages into cache...");

  const cacheChannel =
    client.channels.cache.get(CACHE_CHANNEL_ID) ||
    (await client.channels.fetch(CACHE_CHANNEL_ID).catch(() => null));

  if (!cacheChannel) {
    console.log("Could not find cache channel.");
    return;
  }

  try {
    let lastId = null;
    let batch = 0;

    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const messages = await cacheChannel.messages.fetch(options);
      batch++;

      console.log(
        `Batch ${batch}: fetched ${messages.size} messages (cached users: ${cachedUsers.size})`
      );

      if (messages.size === 0) break;

      messages.forEach((msg) => {
        const user = extractUser(msg);
        if (user) cachedUsers.add(user.toLowerCase());
      });

      const newLastId = messages.last()?.id;
      if (!newLastId || newLastId === lastId) {
        console.log("Reached start of channel.");
        break;
      }

      lastId = newLastId;
      await new Promise((res) => setTimeout(res, 350));
    }

    console.log(`Cache complete. Total cached users: ${cachedUsers.size}`);
    cacheReady = true;
    console.log("Now listening for NEW messages...");
  } catch (err) {
    console.error("Error during caching:", err?.message || err);
  }
});

// ---------- helpers ----------

function extractFromEmbed(embed) {
  // 1) Check fields
  if (embed.fields && embed.fields.length > 0) {
    for (const f of embed.fields) {
      const name = (f.name || "")
        .replace(/\*\*/g, "")
        .trim()
        .toLowerCase();
      if (name.includes("discord")) {
        return String(f.value || "").trim();
      }
    }
  }

  // 2) Check description lines
  if (embed.description) {
    const lines = embed.description.split("\n");
    for (let line of lines) {
      line = line.replace(/\*\*/g, "").trim();
      if (line.toLowerCase().startsWith("discord:")) {
        return line.split(":").slice(1).join(":").trim();
      }
    }
  }

  return null;
}

function extractUser(msg) {
  if (!msg.embeds?.length) return null;
  for (const embed of msg.embeds) {
    const u = extractFromEmbed(embed);
    if (u) return u;
  }
  return null;
}

// ---------- new message listener ----------

client.on("messageCreate", async (msg) => {
  if (!cacheReady) return;
  if (msg.channelId !== WATCH_CHANNEL_ID) return;

  const user = extractUser(msg);
  if (!user) return;

  const key = user.toLowerCase();

  // If user already in cache → duplicate
  if (cachedUsers.has(key)) {
    console.log(`Duplicate detected (already cached): ${user}`);
    return;
  }

  // If NOT in cache → unexpected resend → forward EXACT embed + @everyone
  cachedUsers.add(key);

  console.log(
    `ALERT: Resent user "${user}" → forwarding embed (with @everyone ping)`
  );

  try {
    await axios.post(SECURITY_WEBHOOK, {
      content: "@everyone",
      embeds: msg.embeds.map((e) => e.toJSON()),
    });
  } catch (err) {
    console.error(
      "Error sending embed:",
      err?.response?.status,
      err?.response?.data || err.message
    );
  }
});

client.login(TOKEN);
