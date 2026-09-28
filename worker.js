// Cloudflare Worker: US stock news -> LINE. Cron push + LINE chat commands (owner only).
const MODEL = "google/gemini-2.5-flash-lite";
const NEWS_PER_STOCK = 4;
const DEFAULT_STOCKS = ["NVDA", "MSFT", "GOOGL", "AMD", "PLTR"]  // AI theme;
const MAX_STOCKS = 10;

const LINE_STYLE =
  "\nจัดรูปแบบสำหรับแชท LINE: ห้ามใช้ markdown (ห้าม * # **) ใช้ • แทน bullet " +
  "ขึ้นต้นแต่ละหุ้นด้วย 📌 ชื่อหุ้น และราคา ใส่ 🟢 บวก 🔴 ลบ ⚪ กลาง หน้าผลกระทบ เว้นบรรทัดระหว่างหุ้น\n";

async function getStocks(env) {
  const raw = await env.KV.get("stocks");
  return raw ? JSON.parse(raw) : DEFAULT_STOCKS;
}

const saveStocks = (env, list) => env.KV.put("stocks", JSON.stringify(list));

async function fetchNews(ticker, query = `${ticker} stock`, limit = NEWS_PER_STOCK) {
  const q = encodeURIComponent(query);
  const res = await fetch(`https://news.google.com/rss/search?q=${q}+when:2d&hl=en-US&gl=US&ceid=US:en`);
  const xml = await res.text();
  const titles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) =>
    m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
  );
  return titles.slice(0, limit).map((t) => `- ${t}`);
}

async function fetchPrice(ticker) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return "ไม่มีข้อมูลราคา";
  const j = await res.json();
  const closes = (j.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  if (closes.length < 2) return "ไม่มีข้อมูลราคา";
  const last = closes.at(-1), prev = closes.at(-2);
  return `ปิดล่าสุด ${last.toFixed(2)} ดอลลาร์ (${(((last - prev) / prev) * 100).toFixed(2)}% จากวันก่อน)`;
}

async function summarize(env, data) {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const dd = `${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${now.getUTCFullYear() + 543}`;
  const prompt =
    `วันนี้ ${dd} (พ.ศ.) ธีม: AI. สรุปข่าวต่อไปนี้เป็นไทย สั้นมาก:\n` +
    "1) หัวข้อ 'ข่าววงการ AI' 3 ข้อ\n2) ทีละหุ้น: ราคา + ข่าวเด่น 1 ข้อ + ผลกระทบ บวก/ลบ/กลาง\n" +
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

async function pushSummary(env) {
  const stocks = await getStocks(env);
  if (!stocks.length) return line(env, "push", { to: env.LINE_USER_ID.trim(), messages: text("รายการหุ้นว่าง พิมพ์ เพิ่ม AAPL") });
  const ai = (await fetchNews("", "artificial intelligence AI industry news", 5)).join("\n");
  const parts = await Promise.all(
    stocks.map(async (s) => `## ${s}\nราคา: ${await fetchPrice(s)}\nข่าว:\n${(await fetchNews(s)).join("\n")}`)
  );
  const summary = await summarize(env, `## ข่าววงการ AI\n${ai}\n\n` + parts.join("\n\n"));
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const stamp = `${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCMonth() + 1).padStart(2, "0")} ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  await line(env, "push", {
    to: env.LINE_USER_ID.trim(),
    messages: text(`📈 สรุปข่าว AI + หุ้น ${stamp}\n\n${summary}\n\n(ไม่ใช่คำแนะนำการลงทุน)`),
  });
}

async function validSignature(env, body, sig) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LINE_SECRET.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === sig;
}

async function handleCommand(env, ctx, ev) {
  const msg = (ev.message.text || "").trim();
  const [cmd, arg] = msg.split(/\s+/);
  const ticker = (arg || "").toUpperCase();
  const reply = (t) => line(env, "reply", { replyToken: ev.replyToken, messages: text(t) });
  const list = await getStocks(env);

  if (cmd === "ดู") return reply(`รายการหุ้น: ${list.join(", ") || "(ว่าง)"}`);
  if (cmd === "สรุป") {
    await reply("⏳ กำลังสรุป รอสักครู่");
    ctx.waitUntil(pushSummary(env));
    return;
  }
  if (cmd === "เพิ่ม" || cmd === "ลบ") {
    if (!/^[A-Z.\-]{1,6}$/.test(ticker)) return reply("ใส่ชื่อหุ้นเป็นตัวอักษรอังกฤษ เช่น เพิ่ม AAPL");
    if (cmd === "เพิ่ม") {
      if (list.includes(ticker)) return reply(`มี ${ticker} อยู่แล้ว`);
      if (list.length >= MAX_STOCKS) return reply(`เต็มแล้ว (สูงสุด ${MAX_STOCKS} ตัว)`);
      await saveStocks(env, [...list, ticker]);
      return reply(`✅ เพิ่ม ${ticker} แล้ว`);
    }
    if (!list.includes(ticker)) return reply(`ไม่มี ${ticker} ในรายการ`);
    await saveStocks(env, list.filter((s) => s !== ticker));
    return reply(`✅ ลบ ${ticker} แล้ว`);
  }
  return reply("คำสั่ง: เพิ่ม AAPL · ลบ AAPL · ดู · สรุป");
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(pushSummary(env));
  },

  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ok");
    const body = await request.text();
    if (!(await validSignature(env, body, request.headers.get("x-line-signature") || ""))) {
      return new Response("bad signature", { status: 401 });
    }
    for (const ev of JSON.parse(body).events || []) {
      if (ev.type === "message" && ev.message?.type === "text" && ev.source?.userId === env.LINE_USER_ID.trim()) {
        ctx.waitUntil(handleCommand(env, ctx, ev));
      }
    }
    return new Response("ok");
  },
};
