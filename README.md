# 個人排班行事曆 v4.4

v4.4 保留原本版型，重點修正登入 Google 後 UI 操作與 Drive App Data 的容錯。

## v4.4 修正

- Google 登入後，單次排班、固定排班、事件編輯、月曆切換、本月收入設定等 UI 不再依賴 Drive App Data 是否成功。
- 強化 modal/backdrop：關閉的遮罩完全不接收滑鼠/觸控事件，並確保同一時間只會有一個 modal，避免透明遮罩擋住全頁。
- Drive App Data 與 Google Calendar 同步解耦：
  - Drive API 未啟用或讀取失敗時，Google Calendar 排班仍可正常讀寫。
  - 設定與收入先保存本機快取，之後 App Data 恢復時再同步。
- Drive App Data 狀態分為：
  - 尚未檢查
  - 本機快取
  - 需要授權
  - API 未啟用
  - 讀取失敗
  - 已同步
- 若判定 Drive API 未啟用，設定畫面會直接出現「啟用 Google Drive API」按鈕。
- 增加「檢查 / 載入 App Data」與「重新授權」按鈕。
- 「連線 Google Calendar」不再每次強制跳 consent；只有需要重新授權 Drive scope 時才使用重新授權。

## 雲端資料配置

Google Calendar event：
- 排班日期 / 時間
- 診次類別
- 節費
- 該診 PPF
- 備註

Google Drive App Data：
- 每月牌費
- 額外支援收入
- 健保費用
- 診次顏色
- Google OAuth Client ID（備份）
- Calendar ID
- Apple iCal URL

本機 localStorage：
- App Data 快取
- Calendar 排班快取
- 新裝置啟動所需 OAuth Client ID

## Google Cloud

需啟用：
1. Google Calendar API
2. Google Drive API

OAuth scopes：
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/drive.appdata`

Google Drive `appDataFolder` 是應用程式的隱藏資料區，不會顯示在一般「我的雲端硬碟」檔案列表。

## GitHub Pages 更新

將 ZIP 解壓縮後，把：
- `index.html`
- `app.js`
- `styles.css`
- `.nojekyll`

覆蓋原 GitHub repository 同名檔案並 Commit 即可。
