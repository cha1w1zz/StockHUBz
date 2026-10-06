// Cloudflare Worker: US stock news -> LINE. Cron push + LINE chat commands (owner only).
const MODEL = "google/gemini-2.5-flash-lite";
const NEWS_PER_STOCK = 6;
const DEFAULT_STOCKS = ["NVDA", "MSFT", "GOOGL", "AMD", "PLTR"]; // AI theme
const MAX_STOCKS_ADMIN = 15;
const MAX_STOCKS_USER = 5;
const DEFAULT_TOPICS = ["artificial intelligence AI industry"];
const MAX_TOPICS_ADMIN = 5;
const MAX_TOPICS_USER = 2;
const NEWS_PER_TOPIC = 6;
const MAX_USERS = 10; // including the admin
const MAX_MANUAL_PER_DAY = 5; // "สรุป" presses per non-admin user per day (Bangkok time)

// Design tokens (accessible contrast; min text 12px, tap targets >= 44px)
const GREEN = "#08784B";
const INK = "#1F2937";
const MUTED = "#5B6470";
const WARN = "#B45309";
const qi = (label, msg) => ({ type: "action", action: { type: "message", label, text: msg } });
const btn = (label, msg, primary = false) => ({
  type: "button", height: "md", style: primary ? "primary" : "secondary", color: primary ? GREEN : undefined,
  action: { type: "message", label, text: msg },
});
const pair = (a, b) => ({ type: "box", layout: "horizontal", spacing: "sm", contents: [a, b] });
const step = (n, title, desc) => ({
  type: "box", layout: "horizontal", spacing: "md", margin: "lg",
  contents: [
    { type: "box", layout: "vertical", width: "26px", height: "26px", cornerRadius: "13px", backgroundColor: GREEN, justifyContent: "center", alignItems: "center",
      contents: [{ type: "text", text: String(n), color: "#FFFFFF", size: "sm", weight: "bold", align: "center" }] },
    { type: "box", layout: "vertical", flex: 1, spacing: "xs", contents: [
      { type: "text", text: title, weight: "bold", size: "sm", color: INK, wrap: true },
      { type: "text", text: desc, size: "xs", color: MUTED, wrap: true },
    ] },
  ],
});
const row = (label, value, empty = false) => ({
  type: "box", layout: "vertical", margin: "md", spacing: "xs",
  contents: [
    { type: "text", text: label, size: "xs", color: MUTED },
    { type: "text", text: value, size: "md", weight: "bold", color: empty ? WARN : INK, wrap: true },
  ],
});

// Main menu card. Doubles as a dashboard of the user's own lists.
function menuCard(me, { isNew = false, admin = false } = {}) {
  const maxS = admin ? MAX_STOCKS_ADMIN : MAX_STOCKS_USER;
  const maxT = admin ? MAX_TOPICS_ADMIN : MAX_TOPICS_USER;
  const firstRun = !me.stocks.length && !me.topics.length;
  const body = firstRun
    ? [
        step(1, "กด ➕ เพิ่มหุ้น", `เลือกหุ้นที่สนใจ (สูงสุด ${maxS} ตัว)`),
        step(2, "กด 📰 เพิ่มหัวข้อ", `เช่น พลังงาน AI คริปโต (สูงสุด ${maxT} หัวข้อ)`),
        step(3, "กด ⚡ สรุปเลย", "หรือรอรับอัตโนมัติทุกวัน 19:30"),
      ]
    : [
        row(`📈 หุ้น (${me.stocks.length}/${maxS})`, me.stocks.join(" · ") || "ยังไม่มี กด ➕ เพิ่มหุ้น", !me.stocks.length),
        row(`📰 หัวข้อ (${me.topics.length}/${maxT})`, me.topics.join(" · ") || "ยังไม่มี กด 📰 เพิ่มหัวข้อ", !me.topics.length),
        row("⏰ รอบส่งอัตโนมัติ", "ทุกวัน 19:30"),
      ];
  return [{
    type: "flex",
    altText: `MARKII เมนู: หุ้น ${me.stocks.length}/${maxS}, หัวข้อ ${me.topics.length}/${maxT}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: GREEN, paddingAll: "16px",
        contents: [
          { type: "text", text: "📈 MARKII", color: "#FFFFFF", weight: "bold", size: "xl" },
          { type: "text", text: isNew ? "ลงทะเบียนให้แล้ว เริ่มได้เลย" : "สรุปข่าวหุ้น + หัวข้อที่คุณสนใจ", color: "#E6F7EF", size: "xs", margin: "sm" },
        ],
      },
      body: { type: "box", layout: "vertical", paddingAll: "16px", contents: body },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [btn("⚡ สรุปเลย", "สรุป", true), btn("➕ เพิ่มหุ้น", "เพิ่มหุ้น"), btn("📰 เพิ่มหัวข้อ", "เพิ่มหัวข้อ"), btn("🗑 ลบรายการ", "ลบรายการ")],
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
          { type: "text", text: `${i + 1}. ...${m.slice(-6)}`, size: "sm", weight: "bold", color: INK },
          { type: "text", text: `หุ้น ${u.stocks.length} · หัวข้อ ${u.topics.length}`, size: "xs", color: MUTED },
        ] },
        { type: "button", height: "md", style: "secondary", flex: 0, action: { type: "message", label: "เตะ", text: `เตะ ${i + 1}` } },
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
          { type: "text", text: `ผู้ใช้ ${members.length + 1}/${MAX_USERS} (รวมคุณ)`, color: "#E5E7EB", size: "xs", margin: "sm" },
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
        contents: [
          btn("⚡ สรุปเลย", "สรุป", true),
          pair(btn("➕ เพิ่มหุ้น", "เพิ่มหุ้น"), btn("📰 เพิ่มหัวข้อ", "เพิ่มหัวข้อ")),
          btn("🗑 ลบรายการ", "ลบรายการ"),
          pair(btn("👥 รายชื่อ", "คนใช้"), btn("🔄 รีเฟรช", "แอดมิน")),
          btn("📋 เมนูของฉัน", "เมนู"),
        ],
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

// Drop non-news results (quote/profile pages, price tables, listicles, ads) and near-duplicates.
const JUNK_TITLE = [
  /stock price[, ]/i, /share price/i, /quote\b.*\bhistory/i, /price,? news,? quote/i,
  /ข่าวสารและพาดหัว|พาดหัวล่าสุด/, /\bsponsored\b/i,
  /ราคาหุ้น.*(ข่าว|ใบเสนอราคา|ประวัติ)/, /ใบเสนอราคา/,
  /\b(company )?profile\b/i, /\bhistorical (prices|data)\b/i, /\bstock forecast\b/i, /\bprice target\b.*\b(2030|2035|2040)\b/i,
  /\b(should you buy|is it a buy|better buy|buy now)\b/i, /\b\d+ (best|top) stocks?\b/i,
];
const JUNK_SOURCE = /\s-\s(yahoo finance( \w+)?|investing\.com|marketbeat|stocktwits|tipranks|macrotrends|companiesmarketcap|robinhood|public\.com|stockanalysis)\s*$/i;
const BLOCK_SOURCE = /\s-\s(yahoo finance( \w+)?|stockstotrade|tradingview|gurufocus|tikr( terminal)?|stock titan|ainvest|moomoo|webull|stockinvest\.us|wallstreetzen|barchart)\s*$/i;
function cleanTitles(titles) {
  const seen = new Set();
  return titles.filter((t) => {
    if (JUNK_TITLE.some((re) => re.test(t))) return false;
    if (BLOCK_SOURCE.test(t)) return false;
    if (JUNK_SOURCE.test(t) && /(price|quote|history|ราคา|profile)/i.test(t)) return false;
    const key = t.replace(/\s-\s[^-]+$/, "").toLowerCase().replace(/[^a-z0-9ก-๙]/g, "").slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const CLICKBAIT = /^(why|here'?s why|what'?s (going on|happening|behind))\b|\?|what (happened|to know)|\bexplained\b|here'?s what|should you (buy|sell)|is .{0,40} a (buy|sell)\b|\b(stock|shares)\b.*\b(down|falling|falls|dropping|drops|plunging|sinking|sinks|sliding|slumping|tumbling|soaring|jumping)\b.*\btoday\b/i;

// runs fn with at most n in flight; Google News answers 503/timeouts when ~15 searches fire at once
function makeGate(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, res, rej } = queue.shift();
    fn().then(res, rej).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}
const msLeft = (deadline, cap) => Math.min(cap, deadline - Date.now());

async function fetchNews(ticker, query = `${ticker} stock`, limit = NEWS_PER_STOCK, deadline = Infinity) {
  const q = encodeURIComponent(query);
  // Google sometimes returns empty/blocked when many requests fire at once, so retry and widen the window
  for (const [i, win] of ["2d", "7d"].entries()) {
    try {
      if (msLeft(deadline, 4000) < 800) return []; // out of fetch budget: summarize with what we have
      if (i) await new Promise((r) => setTimeout(r, 300));
      const res = await fetch(`https://news.google.com/rss/search?q=${q}+when:${win}&hl=en-US&gl=US&ceid=US:en`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
        signal: AbortSignal.timeout(msLeft(deadline, 4000)),
      });
      if (!res.ok) {
        console.log("news http", res.status, query, win);
        continue;
      }
      const xml = await res.text();
      const titles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) =>
        m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
      );
      // drop non-news pages/duplicates; stock headlines also drop clickbait like "Why X stock is falling today"; topics keep the rest
      const cleaned = cleanTitles(titles);
      const kept = ticker ? cleaned.filter((t) => !CLICKBAIT.test(t)) : cleaned;
      if (kept.length) return kept.slice(0, limit).map((t) => `- ${t.replace(/\s-\s[^-]+$/, "")}`);
      console.log("news empty", query, win, "raw", titles.length, "cleaned", cleaned.length, "kept", kept.length);
    } catch (e) {
      console.log("news error", query, win, String(e));
    }
  }
  return [];
}

async function fetchPrice(ticker, deadline = Infinity) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(Math.max(500, msLeft(deadline, 4000))),
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

// Yahoo symbol search (free, no AI tokens). Returns null when the lookup itself fails.
async function searchSymbols(q) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return (j.quotes || [])
      .filter((x) => ["EQUITY", "ETF"].includes(x.quoteType) && /^[A-Z.\-]{1,6}$/.test(x.symbol || ""))
      .slice(0, 5)
      .map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname || "" }));
  } catch {
    return null;
  }
}

// LINE turns URLs and bare domains into preview cards, so remove them from the AI text.
const stripLinks = (s) =>
  s
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|co|ai|us|info|biz|tv)\b(?:\/\S*)?/gi, (m) => m.split(".")[0].replace(/^www$/i, ""))
    .replace(/[ \t]+([)\],.])/g, "$1").replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ");

async function summarize(env, data) {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const dd = `${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${now.getUTCFullYear() + 543}`;
  const prompt =
    `วันนี้ ${dd} (พ.ศ.) คุณคือผู้สรุปข่าวหุ้นภาษาไทย\n` +
    "กฎสำคัญ:\n" +
    "- แปลพาดหัวข่าวเป็นภาษาไทยทุกข้อ ห้ามคัดลอกประโยคภาษาอังกฤษ (ยกเว้นชื่อบริษัท ตัวย่อหุ้น และศัพท์เฉพาะ เช่น AI, GPU)\n" +
    "- ทุกหุ้นต้องมีครบทั้ง 4 บรรทัดตามแบบด้านล่าง ห้ามข้ามบรรทัดไหนเด็ดขาด โดยเฉพาะ 'จับตา'\n" +
    "- ใช้เฉพาะตัวเลขและพาดหัวที่ให้มา ห้ามเดา ห้ามแนะนำซื้อขาย ข้อมูลไม่พอให้เขียนว่า ไม่มีข้อมูลเพิ่มเติม\n" +
    "- ถ้ามีพาดหัวเรื่องเดียวกันซ้ำหลายสำนัก อย่าเล่าซ้ำ แต่ยังต้องเขียนข่าวเด่นและสรุปให้ครบเท่าเดิม ห้ามย่อหรือตัดเนื้อหาเพราะเรื่องซ้ำ\n" +
    "- เลือกข่าวที่มีเหตุการณ์จริง (งบ ดีล กฎระเบียบ ผลิตภัณฑ์ ตัวเลขเศรษฐกิจ) พาดหัวเรียกคลิกที่ถามว่าทำไมหุ้นขึ้น/ร่วง หรือ 'เกิดอะไรขึ้น' ให้ข้าม ห้ามเขียนข่าวเด่นที่แค่บอกว่าหุ้นขึ้น/ร่วง หรืออธิบายสาเหตุราคาเอง (ราคาใช้เฉพาะบรรทัดราคาและแนวโน้ม) ถ้าไม่มีข่าวเนื้อๆ เลยให้เขียนว่า ไม่มีข่าวเด่นใหม่ ห้ามตัดบรรทัดทิ้ง\n" +
    "- กระชับ แต่ห้ามตัดบรรทัด\n\n" +
    "แบบสำหรับส่วน '## หัวข้อ:' (ทีละหัวข้อ):\n" +
    "📰 ชื่อหัวข้อ\n• ข่าวเด่น 3-4 ข้อ แปลเป็นไทย\n\n" +
    "แบบสำหรับแต่ละหุ้น (ทำให้ครบทุกตัว):\n" +
    "📌 ตัวย่อหุ้น · ราคาปิด (±% จากวันก่อน)\n" +
    "• แนวโน้ม: 5 วัน ±% · ตำแหน่งเทียบช่วง 52 สัปดาห์ (จากตัวเลขที่ให้)\n" +
    "• ข่าวเด่น: (แปลไทย 2 ข้อ ข้อละ 1 บรรทัด) แต่ละข้อตามด้วย 🟢 บวก / 🔴 ลบ / ⚪ กลาง ถ้ามีข่าวไม่ถึง 2 ข้อให้เขียนเท่าที่มี\n" +
    "• อารมณ์ข่าว: บวก X / ลบ Y / กลาง Z (นับจากพาดหัวที่ให้ นับจริง)\n" +
    "• จับตา: ต้องมีทุกหุ้น ถ้าพาดหัวที่ให้พูดถึงความเสี่ยงหรือเหตุการณ์ที่ต้องติดตาม (เช่น ประกาศงบ กฎระเบียบ คู่แข่ง) ให้สรุป 1 ข้อ ถ้าไม่มีจริงๆ ให้เขียนตรงๆ ว่า ไม่มีข้อมูลเพิ่มเติม ห้ามคิดเองหรือเดาเพื่อให้ครบ\n\n" +
    "ไม่ใช้ markdown (ห้าม * # **) เว้นบรรทัดระหว่างหุ้น\n\n" + data;
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 4000, temperature: 0.2 }),
    signal: AbortSignal.timeout(15000), // fetch budget (12s) + this must stay under waitUntil's ~30s, or the whole run dies silently
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const choice = j.choices[0];
  // safety net: if the model still drops a stock's 'จับตา' line, add the honest fallback instead of leaving it out
  const out = stripLinks(choice.message.content)
    .split(/(?=📌)/)
    .map((b) => (b.startsWith("📌") && !b.includes("จับตา") ? `${b.trimEnd()}\n• จับตา: ไม่มีข้อมูลเพิ่มเติม\n\n` : b))
    .join("");
  return choice.finish_reason === "length" ? out + "\n\n(สรุปยาวเกินจึงถูกตัดท้าย ลดจำนวนหุ้นหรือหัวข้อได้)" : out;
}

async function line(env, path, body) {
  const r = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LINE_TOKEN.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.log("LINE error", r.status, (await r.text()).slice(0, 200));
}

const text = (t, qr) => [{ type: "text", text: t.slice(0, 5000), ...(qr ? { quickReply: { items: qr } } : {}) }];

// cache lets one cron run share fetches between users who follow the same stock/topic
async function pushSummary(env, userId, cache = new Map(), skipEmpty = false, slot = null) {
  const memo = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  const push = (t) => line(env, "push", { to: userId, messages: text(t) });
  const gate = makeGate(3);
  const deadline = Date.now() + 12000;
  const u = await getUser(env, userId);
  // slot is "am"/"pm" on cron runs; users can opt out of one round
  if (slot && u && u.rounds && u.rounds !== "both" && u.rounds !== slot) return;
  if (!u || (!u.stocks.length && !u.topics.length)) {
    if (skipEmpty) return;
    return line(env, "push", { to: userId, messages: menuCard(u || { stocks: [], topics: [] }, { admin: isAdmin(env, userId) }) });
  }
  const topicParts = await Promise.all(
    u.topics.map(async (t) => `## หัวข้อ: ${t}\n${(await memo("t:" + t, () => gate(() => fetchNews("", `${t} news`, NEWS_PER_TOPIC, deadline)))).join("\n") || "(ดึงข่าวไม่ได้ตอนนี้ ให้เขียนว่า ไม่มีข่าวใหม่)"}`)
  );
  const parts = await Promise.all(
    u.stocks.map(async (s) => {
      const [price, news] = await Promise.all([memo("p:" + s, () => gate(() => fetchPrice(s, deadline))), memo("s:" + s, () => gate(() => fetchNews(s, undefined, undefined, deadline)))]);
      return `## ${s}\nราคา: ${price}\nข่าว:\n${news.join("\n") || "(ดึงข่าวไม่ได้ตอนนี้ ให้เขียนว่า ไม่มีข่าวใหม่)"}`;
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
  // LINE text cap is 5000 chars and a push takes up to 5 messages: split on blank lines so long summaries aren't cut
  const chunks = [];
  let cur = "";
  for (const block of `📈 สรุปข่าว ${stamp}\n\n${summary}\n\n(ไม่ใช่คำแนะนำการลงทุน)`.split("\n\n")) {
    if (cur && cur.length + block.length + 2 > 4500) {
      chunks.push(cur);
      cur = block;
    } else cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur) chunks.push(cur);
  await line(env, "push", { to: userId, messages: chunks.slice(0, 5).flatMap((c) => text(c)) });
}

async function validSignature(env, body, sig) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LINE_SECRET.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === sig;
}

async function handleFollow(env, ev, uid) {
  const reply = (m) => line(env, "reply", { replyToken: ev.replyToken, messages: m });
  const existing = await getUser(env, uid);
  if (existing) return reply(menuCard(existing, { admin: isAdmin(env, uid) }));
  const members = await getMembers(env);
  if (members.length + 1 >= MAX_USERS) return reply(text("ขออภัย ตอนนี้ผู้ใช้เต็มแล้ว"));
  await env.KV.put("members", JSON.stringify([...members, uid]));
  await saveUser(env, uid, { stocks: [], topics: [] });
  return reply(menuCard({ stocks: [], topics: [] }, { isNew: true }));
}

async function handleCommand(env, ctx, ev, uid) {
  const msg = (ev.message.text || "").trim();
  const [cmd, arg] = msg.split(/\s+/);
  const rest = msg.slice((cmd || "").length).trim().replace(/\s+/g, " ");
  const ticker = (arg || "").toUpperCase();
  const reply = (t, qr) => line(env, "reply", { replyToken: ev.replyToken, messages: text(t, qr) });
  const after = [qi("⚡ สรุป", "สรุป"), qi("➕ เพิ่มหุ้น", "เพิ่มหุ้น"), qi("📋 เมนู", "เมนู")];
  const admin = isAdmin(env, uid);

  // Open join: anyone who messages the bot is registered, up to MAX_USERS
  let me = await getUser(env, uid);
  if (!me) {
    const members = await getMembers(env);
    if (members.length + 1 >= MAX_USERS) return reply("ขออภัย ตอนนี้ผู้ใช้เต็มแล้ว");
    await env.KV.put("members", JSON.stringify([...members, uid]));
    me = { stocks: [], topics: [] };
    await saveUser(env, uid, me);
    return line(env, "reply", { replyToken: ev.replyToken, messages: menuCard(me, { isNew: true, admin }) });
  }

  const showMenu = () => line(env, "reply", { replyToken: ev.replyToken, messages: menuCard(me, { admin }) });
  if (["วิธีใช้", "เมนู", "help", "ดู", "ดูหัวข้อ"].includes(cmd)) return showMenu();

  // Prompts that answer with one-tap Quick Replies instead of making people type
  if (cmd === "เพิ่มหุ้น" || (cmd === "เพิ่ม" && !arg)) {
    const pick = ["NVDA", "AAPL", "TSLA", "MSFT", "GOOGL", "AMZN", "META", "AMD"].filter((t) => !me.stocks.includes(t)).slice(0, 8);
    return reply("เลือกหุ้นด้านล่าง หรือพิมพ์เองเช่น เพิ่ม PLTR (ตัวอักษรอังกฤษ)", pick.map((t) => qi(t, `เพิ่ม ${t}`)));
  }
  if (cmd === "เพิ่มหัวข้อ") {
    const pick = ["AI", "nuclear energy", "oil price", "crypto"].filter((t) => !me.topics.includes(t.toLowerCase()));
    return reply("เลือกหัวข้อด้านล่าง หรือพิมพ์เองเช่น หัวข้อ+ electric vehicle (ภาษาอังกฤษแม่นกว่า)", pick.map((t) => qi(t, `หัวข้อ+ ${t}`)));
  }
  if (cmd === "ลบรายการ") {
    const items = [...me.stocks.map((t) => qi(`ลบ ${t}`, `ลบ ${t}`)), ...me.topics.map((t) => qi(`ลบ ${t}`.slice(0, 20), `หัวข้อ- ${t}`))];
    return items.length ? reply("เลือกรายการที่จะลบ", items.slice(0, 13)) : reply("รายการยังว่าง ไม่มีอะไรให้ลบ", after);
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
    return line(env, "reply", { replyToken: ev.replyToken, messages: [...text(`✅ เตะผู้ใช้ลำดับ ${n} แล้ว`), ...(await adminCard(env))] });
  }

  if (cmd === "สรุป") {
    if (await env.KV.get("cd:" + uid)) return reply("รอ 1 นาทีค่อยกดใหม่");
    if (!isAdmin(env, uid)) {
      const dayKey = `dc:${uid}:${new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)}`;
      const used = parseInt((await env.KV.get(dayKey)) || "0", 10);
      if (used >= MAX_MANUAL_PER_DAY) return reply(`วันนี้กดสรุปครบ ${MAX_MANUAL_PER_DAY} ครั้งแล้ว พรุ่งนี้ค่อยกดใหม่ (ยังได้รับสรุปอัตโนมัติตามปกติ)`);
      await env.KV.put(dayKey, String(used + 1), { expirationTtl: 172800 });
    }
    await env.KV.put("cd:" + uid, "1", { expirationTtl: 60 });
    await reply("⏳ กำลังสรุป รอสักครู่");
    // waitUntil is killed silently at ~30s, so cap the whole job and tell the user instead of going quiet
    const TIMED_OUT = Symbol();
    ctx.waitUntil(
      Promise.race([pushSummary(env, uid), new Promise((r) => setTimeout(() => r(TIMED_OUT), 26000))]).then((x) =>
        x === TIMED_OUT ? line(env, "push", { to: uid, messages: text("⚠️ สรุปไม่ทัน (ช้าเกิน) ลองกดใหม่อีกครั้ง") }) : undefined
      )
    );
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
      return reply(`✅ เพิ่มหัวข้อ "${t}" แล้ว`, after);
    }
    if (!me.topics.includes(t)) return reply(`ไม่มีหัวข้อ "${t}" (ดูด้วย ดูหัวข้อ)`);
    await saveUser(env, uid, { ...me, topics: me.topics.filter((x) => x !== t) });
    return reply(`✅ ลบหัวข้อ "${t}" แล้ว`, after);
  }

  if (cmd === "เพิ่ม" || cmd === "ลบ") {
    const max = admin ? MAX_STOCKS_ADMIN : MAX_STOCKS_USER;
    if (cmd === "เพิ่ม") {
      let ticker = (rest || "").toUpperCase();
      const looksLikeTicker = /^[A-Z.\-]{1,6}$/.test(ticker);
      // Typed in capitals like NVDA -> use as is. Anything else (apple, tesla, "electric car") -> look it up.
      if (!(looksLikeTicker && rest === ticker)) {
        const found = await searchSymbols(rest);
        if (found === null) {
          if (!looksLikeTicker) return reply("ค้นหาชื่อบริษัทไม่ได้ตอนนี้ ลองพิมพ์ตัวย่อหุ้น เช่น เพิ่ม AAPL");
        } else {
          const exact = found.find((f) => f.symbol === ticker);
          if (exact) ticker = exact.symbol;
          else if (!found.length) return reply(`ไม่พบหุ้น "${rest}" ลองพิมพ์ชื่อบริษัทภาษาอังกฤษ หรือตัวย่อ เช่น เพิ่ม AAPL`);
          else return reply(`เจอหลายตัว เลือกได้เลย:\n${found.map((f) => `${f.symbol} ${f.name}`).join("\n")}`, found.map((f) => qi(`${f.symbol} ${f.name}`.slice(0, 20), `เพิ่ม ${f.symbol}`)));
        }
      }
      if (!/^[A-Z.\-]{1,6}$/.test(ticker)) return reply("ใส่ชื่อหุ้นเป็นตัวอักษรอังกฤษ เช่น เพิ่ม AAPL");
      if (me.stocks.includes(ticker)) return reply(`มี ${ticker} อยู่แล้ว`);
      if (me.stocks.length >= max) return reply(`เต็มแล้ว (สูงสุด ${max} ตัว)`);
      await saveUser(env, uid, { ...me, stocks: [...me.stocks, ticker] });
      return reply(`✅ เพิ่ม ${ticker} แล้ว ลองกด ⚡ สรุป เพื่อดูตัวอย่าง`, after);
    }
    if (!/^[A-Z.\-]{1,6}$/.test(ticker)) return reply("ใส่ชื่อหุ้นเป็นตัวอักษรอังกฤษ เช่น ลบ AAPL");
    if (!me.stocks.includes(ticker)) return reply(`ไม่มี ${ticker} ในรายการ`);
    await saveUser(env, uid, { ...me, stocks: me.stocks.filter((x) => x !== ticker) });
    return reply(`✅ ลบ ${ticker} แล้ว`, after);
  }
  return reply("ไม่เข้าใจคำสั่งนี้ ลองกดปุ่มด้านล่าง", after);
}

export default {
  async scheduled(event, env, ctx) {
    // once a day (LINE free push quota); people with empty lists are skipped so they don't burn quota
    const skipEmpty = true;
    const slot = null;
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
