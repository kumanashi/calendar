# 個人排班行事曆 v4.6

v4.6 保留 v4.5.1 的排班、批次刪除、收入、Google Calendar、Drive App Data 與 Apple iCal 架構，只新增 PIN Gate 與爬蟲限制。

## PIN Gate

- 每次重新整理或重新開啟頁面，都會先鎖住主畫面並要求 PIN。
- 不會在 PIN 驗證前短暫顯示班表或收入。
- PIN 限 4–8 位數字。
- PIN 明碼不會儲存。
- 使用 PBKDF2-HMAC-SHA256 + 16-byte salt + 150,000 iterations。
- salt + one-way hash 儲存在 Google Drive App Data。
- 本機只快取 salt + hash，用於後續每次載入先驗證 PIN，不保存 PIN 明碼。
- v4.6 第一次使用、且 Drive App Data 裡還沒有 PIN 時，會顯示「首次設定 PIN」。
- 新裝置沒有 verifier 時，會先要求 Google OAuth，從 Drive App Data 取得 PIN 設定。
- 新裝置若連 OAuth Client ID 都沒有，PIN 畫面會先要求輸入 Client ID。

## 搜尋引擎 / AI 爬蟲

`index.html` 加入：
- `robots: noindex, nofollow, noarchive, nosnippet, noimageindex`
- `googlebot: noindex, nofollow, nosnippet, noimageindex`
- `bingbot: noindex, nofollow, noarchive, nosnippet, noimageindex`
- `referrer: no-referrer`

另附 `robots.txt`，封鎖：
- 一般 crawler (`User-agent: *`)
- Google-Extended
- GPTBot
- OAI-SearchBot
- ChatGPT-User
- ClaudeBot / Claude-User
- CCBot
- PerplexityBot
- Bytespider

### GitHub Pages 注意

若網址是 `https://帳號.github.io/roster-calendar/`，repository 裡的 `robots.txt` 會在 `/roster-calendar/robots.txt`。
robots.txt 一般必須放在 hostname 根目錄 `https://帳號.github.io/robots.txt` 才是正式控制檔。
因此本版本在專案頁面上最重要的索引防護是 HTML 的 `noindex` meta。

## 安全邊界

GitHub Pages 是公開靜態網站。PIN Gate 是瀏覽器端隱私鎖，不是伺服器端帳密驗證。
知道網址的人仍可下載公開 HTML/CSS/JS，但排班、收入與 Drive App Data 不會寫死在 HTML 中，仍需你的 Google 授權才能讀取。

## 更新

覆蓋 GitHub repository 的：
- index.html
- app.js
- styles.css
- .nojekyll

可一併上傳：
- robots.txt

v4.6 使用 `app.js?v=4.6` 與 `styles.css?v=4.6` 避免舊快取。
