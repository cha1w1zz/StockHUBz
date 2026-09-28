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


def load_key():
    for line in (HERE / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("OPENROUTER_API_KEY missing in .env")


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


def summarize(key, model, data):
    prompt = (
        f"วันนี้คือ {datetime.now():%d/%m/%Y} (พ.ศ. {datetime.now().year + 543}) ห้ามใส่วันที่หรือปีในหัวข้อ\n"
        "สรุปข่าวหุ้นต่อไปนี้เป็นภาษาไทย สั้น อ่านง่าย แยกทีละหุ้น:\n"
        "- ข่าวสำคัญ 2-3 ข้อ\n- ข่าวน่าจะกระทบหุ้นทางบวก/ลบ/กลาง เพราะอะไร\n"
        "ห้ามแนะนำซื้อขาย ถ้าข้อมูลไม่พอให้บอกตรงๆ ห้ามเดา\n\n" + data
    )
    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}]},
        timeout=120,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def main():
    cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
    parts = []
    for s in cfg["stocks"]:
        news = fetch_news(s["query"], cfg["news_per_stock"])
        parts.append(f"## {s['name']}\nราคา: {fetch_price(s['ticker'])}\nข่าว:\n" + "\n".join(news))
    summary = summarize(load_key(), cfg["model"], "\n\n".join(parts))

    out = HERE / "output"
    out.mkdir(exist_ok=True)
    now = datetime.now()
    path = out / f"{now:%Y-%m-%d_%H%M}.md"
    path.write_text(f"# สรุปข่าวหุ้น {now:%d/%m/%Y %H:%M}\n\n{summary}\n", encoding="utf-8")
    print(f"saved {path}")


if __name__ == "__main__":
    main()
