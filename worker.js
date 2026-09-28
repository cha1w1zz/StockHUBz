// Cloudflare Worker: US stock news -> LINE. Cron push + LINE chat commands (owner only).
const MODEL = "google/gemini-2.5-flash-lite";
const NEWS_PER_STOCK = 4;
const DEFAULT_STOCKS = ["NVDA", "MSFT", "GOOGL", "AMD", "PLTR"]; // AI theme
const MAX_STOCKS_ADMIN = 10;
const MAX_STOCKS_USER = 5;
const DEFAULT_TOPICS = ["artificial intelligence AI industry"];
const MAX_TOPICS_ADMIN = 3;
const MAX_TOPICS_USER = 2;
const NEWS_PER_TOPIC = 5;
const MAX_USERS = 10; // including the admin

const HELP = "คำสั่ง: เพิ่ม AAPL · ลบ AAPL · ดู · หัวข้อ+ ชื่อ · หัวข้อ- ชื่อ · ดูหัวข้อ · รอบ 2 / รอบ 1 เช้า / รอบ 1 เย็น · สรุป";

const LINE_STYLE =
  "\nจัดรูปแบบสำหรับแชท LINE: ห้ามใช้ markdown (ห้าม * # **) ใช้ • แทน bullet " +
  "ขึ้นต้นแต่ละหุ้นด้วย 📌 ชื่อหุ้น และราคา ใส่ 🟢 บวก 🔴 ลบ ⚪ กลาง หน้าผลกระทบ เว้นบรรทัดระหว่างหุ้น\n";


// Welcome / how-to card (Flex Message). Buttons send the command as if the user typed it.
const GREEN = "#0B8F5A";
const step = (n, title, desc) => ({
  type: "box", layout: "horizontal", spacing: "md", margin: "lg",
  contents: [
    { type: "box", layout: "vertical", width: "26px", height: "26px", cornerRadius: "13px", backgroundColor: GREEN, justifyContent: "center", alignItems: "center",
      contents: [{ type: "text", text: String(n), color: "#FFFFFF", size: "sm", weight: "bold", align: "center" }] },
    { type: "box", layout: "vertical", flex: 1, spacing: "xs", contents: [
      { type: "text", text: title, weight: "bold", size: "sm", wrap: true },
      { type: "text", text: desc, size: "xs", color: "#666666", wrap: true },
    ] },
  ],
});
const btn = (label, msg, primary = false) => ({
  type: "button", height: "sm", style: primary ? "primary" : "secondary", color: primary ? GREEN : undefined,
  action: { type: "message", label, text: msg },
});

function welcomeCard(isNew = false) {
  return [{
    type: "flex",
    altText: "วิธีใช้ MARKII: พิมพ์ เพิ่ม NVDA เพื่อเริ่มติดตามหุ้น แล้วพิมพ์ สรุป",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: GREEN, paddingAll: "16px",
        contents: [
          { type: "text", text: "📈 MARKII", color: "#FFFFFF", weight: "bold", size: "xl" },
          { type: "text", text: isNew ? "ลงทะเบียนให้แล้ว เริ่มได้เลย" : "สรุปข่าวหุ้น + หัวข้อที่คุณสนใจ", color: "#D6F5E8", size: "xs", margin: "sm" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px",
        contents: [
          step(1, "เพิ่มหุ้น (สูงสุด 5 ตัว)", "พิมพ์ เพิ่ม NVDA หรือ เพิ่ม AAPL"),
          step(2, "เพิ่มหัวข้อข่าว (สูงสุด 2)", "พิมพ์ หัวข้อ+ nuclear energy (ภาษาอังกฤษแม่นกว่า)"),
          step(3, "ขอสรุปทันที", "พิมพ์ สรุป หรือรอรับอัตโนมัติ 10:00 และ 19:30"),
          { type: "separator", margin: "lg" },
          { type: "text", text: "ลบ: ลบ NVDA · หัวข้อ- ชื่อ\nดูรายการ: ดู · ดูหัวข้อ\nเลือกรอบ: รอบ 1 เช้า / รอบ 1 เย็น / รอบ 2", size: "xxs", color: "#888888", wrap: true, margin: "md" },
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [btn("➕ เพิ่ม NVDA", "เพิ่ม NVDA", true), btn("📋 ดูรายการของฉัน", "ดู"), btn("⚡ สรุปเลย", "สรุป")],
      },
    },
  }];
}

// Admin-only card: member list with a kick button per member, plus shortcuts.
async function adminCard(env) {
  const members = await getMembers(env);
  const rows = [];
  for (const [i, m] of members.entries()) {
    const u = (await getUser(env, m)) || { stocks: [], topics: [] };
    rows.push({
      type: "box", layout: "horizontal", alignItems: "center", margin: "md",
      contents: [
        { type: "box", layout: "vertical", flex: 1, contents: [
          { type: "text", text: `${i + 1}. ...${m.slice(-6)}`, size: "sm", weight: "bold" },
          { type: "text", text: `หุ้น ${u.stocks.length} · หัวข้อ ${u.topics.length}${u.rounds && u.rounds !== "both" ? " · " + (u.rounds === "am" ? "เช้า" : "เย็น") : ""}`, size: "xxs", color: "#888888" },
        ] },
        { type: "button", height: "sm", style: "secondary", flex: 0, action: { type: "message", label: "เตะ", text: `เตะ ${i + 1}` } },
      ],
    });
  }
  return [{
    type: "flex",
    altText: `แผงแอดมิน: ผู้ใช้ ${members.length + 1}/${MAX_USERS}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#1F2937", paddingAll: "16px",
        contents: [
          { type: "text", text: "🛠 แผงแอดมิน MARKII", color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: `ผู้ใช้ ${members.length + 1}/${MAX_USERS} (รวมคุณ)`, color: "#D1D5DB", size: "xs", margin: "sm" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px",
        contents: rows.length
          ? [{ type: "text", text: "สมาชิก (กด เตะ เพื่อลบออก)", size: "xs", color: "#666666" }, ...rows]
          : [{ type: "text", text: "ยังไม่มีสมาชิกอื่น", size: "sm", color: "#888888" }],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [btn("⚡ สรุปเลย", "สรุป", true), btn("📋 รายการของฉัน", "ดู"), btn("📖 การ์ดวิธีใช้ (ของผู้ใช้)", "วิธีใช้")],
      },
    },
  }];
}

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
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return "ไม่มีข้อมูลราคา";
    const j = await res.json();
    const closes = (j.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
    if (closes.length < 6) return "ไม่มีข้อมูลราคา";
    const last = closes.at(-1), prev = closes.at(-2), d5 = closes.at(-6);
    const hi = Math.max(...closes), lo = Math.min(...closes);
    const pct = (a, b) => (((a - b) / b) * 100).toFixed(2);
    return (
      `ปิดล่าสุด ${last.toFixed(2)} ดอลลาร์ (${pct(last, prev)}% จากวันก่อน) · 5 วัน ${pct(last, d5)}% · ` +
      `52 สัปดาห์ ต่ำ ${lo.toFixed(2)} สูง ${hi.toFixed(2)} (ห่างจากสูงสุด ${pct(last, hi)}%)`
    );
  } catch {
    return "ไม่มีข้อมูลราคา";
  }
}

async function summarize(env, data) {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const dd = `${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${now.getUTCFullYear() + 543}`;
  const prompt =
    `วันนี้ ${dd} (พ.ศ.) สรุปข่าวต่อไปนี้เป็นไทย สั้นมาก:\n` +
    "1) ทีละหัวข้อ (ส่วน ## หัวข้อ:) สรุปข่าวเด่น 2-3 ข้อ\n" +
    "2) ทีละหุ้น เรียงบรรทัดตามนี้: ราคาวันนี้ · แนวโน้ม 5 วัน + ตำแหน่งเทียบช่วง 52 สัปดาห์ (ใช้ตัวเลขที่ให้เท่านั้น) · ข่าวเด่น 1 ข้อ + ผลกระทบ บวก/ลบ/กลาง · " +
    "อารมณ์ข่าว: นับพาดหัวที่ให้ว่า บวก/ลบ/กลาง อย่างละกี่ข้อ (นับจริง ห้ามเดา) · จับตา: ความเสี่ยงหรือสิ่งที่ควรติดตาม 1 ข้อ อ้างจากพาดหัวที่ให้เท่านั้น ถ้าไม่มีให้เขียนว่า ไม่มีข้อมูลเพิ่มเติม\n" +
    "ห้ามแนะนำซื้อขาย ข้อมูลไม่พอให้บอกตรงๆ ห้ามเดา\n" + LINE_STYLE + "\n" + data;
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 1300 }),
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
async function pushSummary(env, userId, cache = new Map(), skipEmpty = false, slot = null) {
  const memo = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  const push = (t) => line(env, "push", { to: userId, messages: text(t) });
  const u = await getUser(env, userId);
  // slot is "am"/"pm" on cron runs; users can opt out of one round
  if (slot && u && u.rounds && u.rounds !== "both" && u.rounds !== slot) return;
  if (!u || (!u.stocks.length && !u.topics.length)) {
    if (skipEmpty) return;
    return line(env, "push", { to: userId, messages: welcomeCard() });
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
  await push(`📈 สรุปข่าว ${stamp}\n\n${summary.slice(0, 4600)}\n\n(ไม่ใช่คำแนะนำการลงทุน)`);
}

async function validSignature(env, body, sig) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LINE_SECRET.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === sig;
}

async function handleFollow(env, ev, uid) {
  const reply = (m) => line(env, "reply", { replyToken: ev.replyToken, messages: m });
  if (await getUser(env, uid)) return reply(welcomeCard());
  const members = await getMembers(env);
  if (members.length + 1 >= MAX_USERS) return reply(text("ขออภัย ตอนนี้ผู้ใช้เต็มแล้ว"));
  await env.KV.put("members", JSON.stringify([...members, uid]));
  await saveUser(env, uid, { stocks: [], topics: [] });
  return reply(welcomeCard(true));
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
    return line(env, "reply", { replyToken: ev.replyToken, messages: welcomeCard(true) });
  }

  if (cmd === "วิธีใช้" || cmd === "เมนู" || cmd === "help") {
    return line(env, "reply", { replyToken: ev.replyToken, messages: welcomeCard() });
  }
  if (admin && (cmd === "แอดมิน" || cmd === "admin")) {
    return line(env, "reply", { replyToken: ev.replyToken, messages: await adminCard(env) });
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

  if (cmd === "รอบ") {
    const map = { "2": "both", "1 เช้า": "am", "1 เย็น": "pm" };
    const v = map[rest];
    if (!v) return reply("พิมพ์: รอบ 2 (เช้า+เย็น) · รอบ 1 เช้า (10:00) · รอบ 1 เย็น (19:30)");
    await saveUser(env, uid, { ...me, rounds: v });
    return reply(`✅ ตั้งรอบแล้ว: ${rest === "2" ? "วันละ 2 รอบ (10:00 และ 19:30)" : rest === "1 เช้า" ? "เฉพาะเช้า 10:00" : "เฉพาะเย็น 19:30"}`);
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
      const maxTopics = admin ? MAX_TOPICS_ADMIN : MAX_TOPICS_USER;
      if (me.topics.length >= maxTopics) return reply(`เต็มแล้ว (สูงสุด ${maxTopics} หัวข้อ) ลบก่อนด้วย หัวข้อ- ชื่อ`);
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
  return line(env, "reply", { replyToken: ev.replyToken, messages: welcomeCard() });
}

export default {
  async scheduled(event, env, ctx) {
    // People with empty lists only get the reminder on the morning run (03:00 UTC = 10:00 BKK)
    const morning = event.cron === "0 3 * * *";
    const skipEmpty = !morning;
    const slot = morning ? "am" : "pm";
    ctx.waitUntil(
      (async () => {
        const cache = new Map();
        for (const id of await recipients(env)) {
          try {
            await pushSummary(env, id, cache, skipEmpty, slot);
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
      if (ev.type === "follow" && ev.source?.userId && !ev.deliveryContext?.isRedelivery) {
        ctx.waitUntil(handleFollow(env, ev, ev.source.userId));
        continue;
      }
      if (ev.type === "message" && ev.message?.type === "text" && ev.source?.userId && !ev.deliveryContext?.isRedelivery) {
        ctx.waitUntil(handleCommand(env, ctx, ev, ev.source.userId));
      }
    }
    return new Response("ok");
  },
};
