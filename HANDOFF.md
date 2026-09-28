# Stock News — Handoff (2026-09-29)

## What it is
Thai stock news summarizer. Google News RSS (free, last 2 days) + yfinance price (free) → OpenRouter `google/gemini-2.5-flash-lite` summary. Uses zero Claude quota. Cost ≈ <0.05 บาท/run.

## Main: GitHub Actions → LINE (added 2026-09-29, working)
- `.github/workflows/daily.yml`: cron 02:00 & 10:30 UTC (= 09:00 & 17:30 BKK) + manual "Run workflow". Keepalive step re-enables workflow (60-day rule).
- Secrets: `OPENROUTER_API_KEY` (separate key `github-line`, $1 limit), `LINE_TOKEN`, `LINE_USER_ID`. LINE bot = OA "MARKII" (provider "Ai agent", channel 2011385460).
- news.py: if LINE_TOKEN set → LINE-style prompt (no markdown, 📌 🟢🔴⚪) + push. Log prints key shape/fingerprint + OpenRouter error body (never the key).
- Short/generic tickers (AI, A, CK) fetch unrelated news → use company name in config `query`.

## Two ways it runs
1. **Local (DISABLED 2026-09-29, replaced by GitHub→LINE; re-enable: `schtasks /change /tn StockNews /enable`)** — Windows Task Scheduler task `StockNews`, daily 09:00 & 17:30 (StartWhenAvailable), runs `pythonw news.py`. Key from `.env` (`OPENROUTER_API_KEY=...`, never commit). Output → `output/YYYY-MM-DD_HHMM.md`. Manual run: double-click `อ่านข่าว.bat` (runs + opens newest file). Stocks: `config.json`.
2. **Online web app** — Streamlit Cloud: https://stockappz-9fvaku5nj5ctbkybdjzce7.streamlit.app/
   - Code: https://github.com/cha1w1zz/StockHUBz (public, branch main). `git push` → auto-redeploy.
   - `app.py`: user pastes own OpenRouter key (not stored server-side; optional "จำ key ในเครื่องนี้" checkbox saves it in browser localStorage via `streamlit-local-storage`, untick = erase), stocks space-separated (max 10, auto `.BK`), remembered in URL `?stocks=`.
   - Tested with fake key → correct "API key ไม่ถูกต้อง". Real-key test on the live site: user to confirm.

## Files
`news.py` (fetch_news, fetch_price, summarize, main) · `app.py` · `config.json` · `requirements.txt` · `.gitignore` (.env, output/, *.bat) · `.env` (local only)
Git identity (repo-local): cha1w1zz / cha1w1zz@users.noreply.github.com.

## Known limits
- Headlines only (no full article text) → shallow analysis.
- Streamlit free app sleeps after ~7 days idle.
- Key passes through Streamlit server (not stored). Advise users: separate key, low credit limit (~$1).
- Not investment advice.

## Ideas not built (user hasn't approved)
- Send local summaries to Telegram/LINE.
- DeepSeek as 2nd-pass "devil's advocate" critic (+~2–5 บาท/เดือน).
- Simpler `หุ้น.txt` list instead of config.json for local run.
- Browser-only key version (key never leaves browser) if opening to strangers.

## User prefs
Reply in Thai, plain words; costs in บาท; show plan + "ควรทำแบบนี้ไหม?" before non-trivial changes.
