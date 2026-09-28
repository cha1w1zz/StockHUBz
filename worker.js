// Cloudflare Worker: US stock news -> LINE. Cron push + LINE chat commands (owner only).
const MODEL = "google/gemini-2.5-flash-lite";
const NEWS_PER_STOCK = 4;
const DEFAULT_STOCKS = ["NVDA", "MSFT", "GOOGL", "AMD", "PLTR"]; // AI theme
const MAX_STOCKS_ADMIN = 10;
const MAX_STOCKS_USER = 5;
const DEFAULT_TOPICS = ["artificial intelligence AI industry"];
const MAX_TOPICS = 3;
const NEWS_PER_TOPIC = 5;
const MAX_USERS = 10; // including the admin

const HELP = "คำสั่ง: เพิ่ม AAPL · ลบ AAPL · ดู · หัวข้อ+ ชื่อ · หัวข้อ- ชื่อ · ดูหัวข้อ · สรุป";

const LINE_STYLE =
  "\nจัดรูปแบบสำหรับแชท LINE: ห้ามใช้ markdown (ห้าม * # **) ใช้ • แทน bullet " +
  "ขึ้นต้นแต่ละหุ้นด้วย 📌 ชื่อหุ้น และราคา ใส่ 🟢 บวก 🔴 ลบ ⚪ กลาง หน้าผลกระทบ เว้นบรรทัดระหว่างหุ้น\n";

const adminId = (env) => env.LINE_USER_ID.trim();
const isAdmin = (env, id) => id === adminId(env);

async function kvJson(env, key, fallback) {
  try {
    const raw = await env.KV.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

const getMembers = (env) => kvJson(env, "members", []);
const saveUser = (env, id, u) => env.KV.put("u:" + id, JSON.stringify(u));

// Per-user lists. The admin falls back to the old single-user keys so nothing is lost.
async function getUser(env, id) {
  const u = await kvJson(env, "u:" + id, null);
  if (u) return u;
  if (isAdmin(env, id)) {
    return {
      stocks: await kvJson(env, "stocks", DEFAULT_STOCKS),
      topics: await kvJson(env, "topics", DEFAULT_TOPICS),
    };
  }
  return null;
}

async function recipients(env) {
  const members = await getMembers(env);
  return [adminId(env), ...members.filter((m) => m !== adminId(env))];
}

async function fetchNews(ticker, query = `${ticker} stock`, limit = NEWS_PER_STOCK) {
  try {
    const q = encodeURIComponent(query);
    const res = await fetch(`https://news.google.com/rss/search?q=${q}+when:2d&hl=en-US&gl=US&ceid=US:en`);
    if (!res.ok) return [];
    const xml = await res.text();
    const titles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) =>
      m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
    );
    return titles.slice(0, limit).map((t) => `- ${t}`);
  } catch {
    return [];
  }
}

async function fetchPrice(ticker) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return "ไม่มีข้อมูลราคา";
    const j = await res.json();
    const closes = (j.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
    if (closes.length < 2) return "ไม่มีข้อมูลราคา";
    const last = closes.at(-1), prev = closes.at(-2);
    return `ปิดล่าสุด ${last.toFixed(2)} ดอลลาร์ (${(((last - prev) / prev) * 100).toFixed(2)}% จากวันก่อน)`;
  } catch {
    return "ไม่มีข้อมูลราคา";
  }
}

async function summarize(env, data) {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const dd = `${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${now.getUTCFullYear() + 543}`;
  const prompt =
    `วันนี้ ${dd} (พ.ศ.) สรุปข่าวต่อไปนี้เป็นไทย สั้นมาก:\n` +
    "1) ทีละหัวข้อ (ส่วน ## หัวข้อ:) สรุปข่าวเด่น 2-3 ข้อ\n2) ทีละหุ้น: ราคา + ข่าวเด่น 1 ข้อ + ผลกระทบ บวก/ลบ/กลาง\n" +
    "ห้ามแนะนำซื้อขาย ข้อมูลไม่พอให้บอกตรงๆ ห้ามเดา\n" + LINE_STYLE + "\n" + data;
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 900 }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).choices[0].message.content;
}

async function line(env, path, body) {
  const r = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LINE_TOKEN.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.log("LINE error", r.status, (await r.text()).slice(0, 200));
}

const text = (t) => [{ type: "text", text: t.slice(0, 5000) }];

// cache lets one cron run share fetches between users who follow the same stock/topic
async function pushSummary(env, userId, cache = new Map()) {
  const memo = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  const push = (t) => line(env, "push", { to: userId, messages: text(t) });
  const u = await getUser(env, userId);
  if (!u || (!u.stocks.length && !u.topics.length)) {
    return push("ยังไม่มีหุ้นหรือหัวข้อ พิมพ์ เพิ่ม AAPL หรือ หัวข้อ+ nuclear energy");
  }
  const topicParts = await Promise.all(
    u.topics.map(async (t) => `## หัวข้อ: ${t}\n${(await memo("t:" + t, () => fetchNews("", `${t} news`, NEWS_PER_TOPIC))).join("\n")}`)
  );
  const parts = await Promise.all(
    u.stocks.map(async (s) => {
      const [price, news] = await Promise.all([memo("p:" + s, () => fetchPrice(s)), memo("s:" + s, () => fetchNews(s))]);
      return `## ${s}\nราคา: ${price}\nข่าว:\n${news.join("\n")}`;
    })
  );
  let summary;
  try {
    summary = await summarize(env, [...topicParts, ...parts].join("\n\n"));
  } catch (e) {
    console.log("summarize failed", String(e));
    return push("⚠️ สรุปไม่สำเร็จ ลองใหม่ภายหลัง");
  }
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const stamp = `${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCMonth() + 1).padStart(2, "0")} ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  await push(`📈 สรุปข่าว ${stamp}\n\n${summary}\n\n(ไม่ใช่คำแนะนำการลงทุน)`);
}

async function validSignature(env, body, sig) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LINE_SECRET.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === sig;
}

async function handleCommand(env, ctx, ev, uid) {
  const msg = (ev.message.text || "").trim();
  const [cmd, arg] = msg.split(/\s+/);
  const rest = msg.slice((cmd || "").length).trim().replace(/\s+/g, " ");
  const ticker = (arg || "").toUpperCase();
  const reply = (t) => line(env, "reply", { replyToken: ev.replyToken, messages: text(t) });
  const admin = isAdmin(env, uid);

  // Open join: anyone who messages the bot is registered, up to MAX_USERS
  let me = await getUser(env, uid);
  if (!me) {
    const members = await getMembers(env);
    if (members.length + 1 >= MAX_USERS) return reply("ขออภัย ตอนนี้ผู้ใช้เต็มแล้ว");
    await env.KV.put("members", JSON.stringify([...members, uid]));
    me = { stocks: [], topics: [] };
    await saveUser(env, uid, me);
    return reply(`👋 ยินดีต้อนรับ ลงทะเบียนให้แล้ว\n${HELP}`);
  }

  if (admin && cmd === "คนใช้") {
    const members = await getMembers(env);
    const lines = members.map((m, i) => `${i + 1}. ...${m.slice(-6)}`);
    return reply(`ผู้ใช้ ${members.length + 1}/${MAX_USERS} (รวมแอดมิน)\n${lines.join("\n") || "(ยังไม่มีสมาชิกอื่น)"}`);
  }
  if (admin && cmd === "เตะ") {
    const members = await getMembers(env);
    const n = parseInt(arg, 10);
    if (!(n >= 1 && n <= members.length)) return reply("พิมพ์ เตะ เลขลำดับ (ดูลำดับจาก คนใช้)");
    const gone = members[n - 1];
    await env.KV.put("members", JSON.stringify(members.filter((m) => m !== gone)));
    await env.KV.delete("u:" + gone);
    return reply(`✅ ลบผู้ใช้ลำดับ ${n} แล้ว`);
  }

  if (cmd === "ดู") return reply(`รายการหุ้น: ${me.stocks.join(", ") || "(ว่าง)"}`);
  if (cmd === "ดูหัวข้อ") return reply(`หัวข้อ: ${me.topics.join(", ") || "(ว่าง)"}`);

  if (cmd === "สรุป") {
    if (await env.KV.get("cd:" + uid)) return reply("รอ 1 นาทีค่อยกดใหม่");
    await env.KV.put("cd:" + uid, "1", { expirationTtl: 60 });
    await reply("⏳ กำลังสรุป รอสักครู่");
    ctx.waitUntil(pushSummary(env, uid));
    return;
  }

  if (cmd === "หัวข้อ+" || cmd === "หัวข้อ-") {
    const t = rest.toLowerCase();
    if (!t || t.length > 60) return reply("พิมพ์ เช่น หัวข้อ+ nuclear energy (ไม่เกิน 60 ตัวอักษร)");
    if (cmd === "หัวข้อ+") {
      if (me.topics.includes(t)) return reply(`มีหัวข้อ "${t}" อยู่แล้ว`);
      if (me.topics.length >= MAX_TOPICS) return reply(`เต็มแล้ว (สูงสุด ${MAX_TOPICS} หัวข้อ) ลบก่อนด้วย หัวข้อ- ชื่อ`);
      await saveUser(env, uid, { ...me, topics: [...me.topics, t] });
      return reply(`✅ เพิ่มหัวข้อ "${t}" แล้ว`);
    }
    if (!me.topics.includes(t)) return reply(`ไม่มีหัวข้อ "${t}" (ดูด้วย ดูหัวข้อ)`);
    await saveUser(env, uid, { ...me, topics: me.topics.filter((x) => x !== t) });
    return reply(`✅ ลบหัวข้อ "${t}" แล้ว`);
  }

  if (cmd === "เพิ่ม" || cmd === "ลบ") {
    if (!/^[A-Z.\-]{1,6}$/.test(ticker)) return reply("ใส่ชื่อหุ้นเป็นตัวอักษรอังกฤษ เช่น เพิ่ม AAPL");
    const max = admin ? MAX_STOCKS_ADMIN : MAX_STOCKS_USER;
    if (cmd === "เพิ่ม") {
      if (me.stocks.includes(ticker)) return reply(`มี ${ticker} อยู่แล้ว`);
      if (me.stocks.length >= max) return reply(`เต็มแล้ว (สูงสุด ${max} ตัว)`);
      await saveUser(env, uid, { ...me, stocks: [...me.stocks, ticker] });
      return reply(`✅ เพิ่ม ${ticker} แล้ว`);
    }
    if (!me.stocks.includes(ticker)) return reply(`ไม่มี ${ticker} ในรายการ`);
    await saveUser(env, uid, { ...me, stocks: me.stocks.filter((x) => x !== ticker) });
    return reply(`✅ ลบ ${ticker} แล้ว`);
  }
  return reply(HELP);
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const cache = new Map();
        for (const id of await recipients(env)) {
          try {
            await pushSummary(env, id, cache);
          } catch (e) {
            console.log("push failed", String(e));
          }
        }
      })()
    );
  },

  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ok");
    const body = await request.text();
    if (!(await validSignature(env, body, request.headers.get("x-line-signature") || ""))) {
      return new Response("bad signature", { status: 401 });
    }
    for (const ev of JSON.parse(body).events || []) {
      if (ev.type === "message" && ev.message?.type === "text" && ev.source?.userId && !ev.deliveryContext?.isRedelivery) {
        ctx.waitUntil(handleCommand(env, ctx, ev, ev.source.userId));
      }
    }
    return new Response("ok");
  },
};
