# 個人排班行事曆 v4.7.2

v4.7.2 延續 v4.6，並保留 v4.5.1 的排班、批次刪除、收入、Google Calendar、Drive App Data 與 Apple iCal 架構，只新增 PIN Gate 與爬蟲限制。

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

v4.7.2 使用 `app.js?v=4.7` 與 `styles.css?v=4.7` 避免舊快取。


## v4.7.2 新增

- 月份切換加入淡出 / 水平滑動轉場；支援 `prefers-reduced-motion`。
- 所有 modal 彈窗加入淡入、位移、縮放的開啟 / 關閉動畫。
- 單次與固定排班的「班別名稱」「地點 / 診所」增加常用候選。
- 候選直接從目前已同步 / 快取的既有排班統計，依使用次數排序，不另建資料表。
- 欄位仍可自由輸入新內容；新內容存成事件後，之後會自動成為候選。


## v4.7.2 修正

- 修正沙盒/本機預覽中 PIN 按鈕看似無反應的問題。
- 正式 GitHub Pages 仍使用 PBKDF2 + Web Crypto 驗證 PIN，安全架構不變。
- 預覽版固定 PIN `2468` 使用純示範驗證，不依賴 Web Crypto。
- 預覽版將 Google / Drive / Apple 的網路動作替換為本地示範回應，因此可逐一測試按鈕。
- 增加 button / modal / PIN gate 的 pointer-events 與 touch-action 點擊保護。


## v4.7.2 預覽修正

- 找到 v4.7.1 預覽不能解鎖的真正原因：部分沙盒 HTML 預覽禁止 native `localStorage`。
- 預覽版在偵測到 `localStorage` 被封鎖時，會改用記憶體型 storage shim，因此 JavaScript 不會在 PIN handler 綁定前中斷。
- 預覽 PIN 仍為 `2468`，且不依賴 Web Crypto。
- 正式 GitHub Pages 版不使用此 preview shim，原本 PIN / Drive App Data 架構維持不變。
