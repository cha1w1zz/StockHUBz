"""Fetch stock news (Google News RSS) + prices (yfinance), summarize via OpenRouter."""
import json
import os
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests
import yfinance as yf

HERE = Path(__file__).parent


BKK = timezone(timedelta(hours=7))


def env(name):
    """Read from environment (GitHub Secrets) first, then local .env."""
    if os.environ.get(name, "").strip():
        return os.environ[name].strip().strip('"')
    f = HERE / ".env"
    for line in f.read_text(encoding="utf-8").splitlines() if f.exists() else []:
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return ""


def fetch_news(query, limit):
    url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(query) + "&hl=th&gl=TH&ceid=TH:th"
    root = ET.fromstring(requests.get(url, timeout=20).content)
    cutoff = datetime.now(timezone.utc) - timedelta(days=2)
    items = [i for i in root.findall("./channel/item") if parsedate_to_datetime(i.findtext("pubDate")) >= cutoff]
    return [f"- {i.findtext('title')} ({i.findtext('pubDate')})" for i in items[:limit]]


def fetch_price(ticker):
    hist = yf.Ticker(ticker).history(period="5d")
    if len(hist) < 2:
        return "ไม่มีข้อมูลราคา"
    last, prev = hist["Close"].iloc[-1], hist["Close"].iloc[-2]
    return f"ปิดล่าสุด {last:.2f} บาท ({(last - prev) / prev * 100:+.2f}% จากวันก่อน)"


LINE_STYLE = (
    "\nจัดรูปแบบสำหรับแชท LINE: ห้ามใช้ markdown (ห้าม * # **) ใช้ • แทน bullet "
    "ขึ้นต้นแต่ละหุ้นด้วย 📌 ชื่อหุ้น และราคา ใส่ 🟢 บวก 🔴 ลบ ⚪ กลาง หน้าผลกระทบ เว้นบรรทัดระหว่างหุ้น\n"
)


def summarize(key, model, data, style=""):
    now = datetime.now(BKK)
    prompt = (
        f"วันนี้คือ {now:%d/%m/%Y} (พ.ศ. {now.year + 543}) ห้ามใส่วันที่หรือปีในหัวข้อ\n"
        "สรุปข่าวหุ้นต่อไปนี้เป็นภาษาไทย สั้น อ่านง่าย แยกทีละหุ้น:\n"
        "- ข่าวสำคัญ 2-3 ข้อ\n- ข่าวน่าจะกระทบหุ้นทางบวก/ลบ/กลาง เพราะอะไร\n"
        "ห้ามแนะนำซื้อขาย ถ้าข้อมูลไม่พอให้บอกตรงๆ ห้ามเดา\n" + style + "\n" + data
    )
    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}]},
        timeout=120,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def send_line(token, user_id, text):
    r = requests.post(
        "https://api.line.me/v2/bot/message/push",
        headers={"Authorization": f"Bearer {token}"},
        json={"to": user_id, "messages": [{"type": "text", "text": text[:5000]}]},
        timeout=30,
    )
    r.raise_for_status()


def main():
    cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
    parts = []
    for s in cfg["stocks"]:
        news = fetch_news(s["query"], cfg["news_per_stock"])
        parts.append(f"## {s['name']}\nราคา: {fetch_price(s['ticker'])}\nข่าว:\n" + "\n".join(news))
    key = env("OPENROUTER_API_KEY") or sys.exit("OPENROUTER_API_KEY missing")
    line_token, line_user = env("LINE_TOKEN"), env("LINE_USER_ID")
    summary = summarize(key, cfg["model"], "\n\n".join(parts), LINE_STYLE if line_token else "")

    now = datetime.now(BKK)
    if line_token:
        send_line(line_token, line_user, f"📈 สรุปข่าวหุ้น {now:%d/%m %H:%M}\n\n{summary}\n\n(ไม่ใช่คำแนะนำการลงทุน)")
        print("sent to LINE")

    out = HERE / "output"
    out.mkdir(exist_ok=True)
    path = out / f"{now:%Y-%m-%d_%H%M}.md"
    path.write_text(f"# สรุปข่าวหุ้น {now:%d/%m/%Y %H:%M}\n\n{summary}\n", encoding="utf-8")
    print(f"saved {path}")


if __name__ == "__main__":
    main()
