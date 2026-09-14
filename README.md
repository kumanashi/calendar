# 個人排班行事曆 v4.2

本版保留 v4.1 的單欄灰白版面與排班操作，將跨裝置設定改為 Google Drive App Data。

## 資料儲存

### Google Calendar 事件
- 排班日期 / 時間
- 診次類別
- 節費
- 每診 PPF
- 診所 / 地點 / 備註

### Google Drive App Data（隱藏應用資料）
- Google OAuth Client ID（備份）
- 排班 Calendar ID
- Apple Secret iCal URL
- 各診次統一顏色
- 每月牌費
- 每月額外支援收入
- 每月健保費用

不再建立「收入設定」Google Calendar 特殊事件。

## 首次設定

Google Cloud 專案需同時啟用：
1. Google Calendar API
2. Google Drive API

OAuth Web client 需使用下列 scopes：
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/drive.appdata`

在 Google Auth Platform > Data Access 中也建議加入上述 scopes。

## 新裝置為什麼仍需先輸入一次 OAuth Client ID？

這是 OAuth 的啟動順序限制：瀏覽器必須先知道 Client ID 才能向 Google 取得 `drive.appdata` 存取權，因此不可能在尚未授權前先從 App Data 讀回 Client ID。

新裝置第一次只要輸入 OAuth Client ID 並授權一次；之後 Calendar ID、iCal URL、顏色與收入設定都會從 Drive App Data 自動載入。Client ID 本身也會備份到 App Data。

## v4.1 升級

第一次成功取得 Drive App Data 權限時，如果雲端設定檔尚不存在，v4.2 會嘗試搬移目前瀏覽器內的：
- Calendar ID
- iCal URL
- 診次顏色
- 月收入設定

並建立 `roster-calendar-v4.2.json` 到 App Data。

## 發布到 GitHub Pages

把 `index.html`、`app.js`、`styles.css`、`.nojekyll` 覆蓋到原 repository 後 Commit 即可。
