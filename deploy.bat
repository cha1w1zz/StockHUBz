@echo off
cd /d "%~dp0"
echo === MARKII deploy ===
if not exist wrangler.toml (
  echo ERROR: wrangler.toml not found in %cd%
  echo Put deploy.bat inside the stock-news folder.
  pause
  exit /b 1
)
echo [1/2] Getting latest code...
git pull origin main
if errorlevel 1 (
  echo ERROR: git pull failed. Screenshot this window and send it.
  pause
  exit /b 1
)
echo [2/2] Deploying to Cloudflare...
call npx.cmd wrangler deploy
if errorlevel 1 (
  echo ERROR: deploy failed. Screenshot this window and send it.
  pause
  exit /b 1
)
echo.
echo DONE. Worker name above should be stock-news-line.
pause
