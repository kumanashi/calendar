# 個人排班表 v3（GitHub Pages）

純 HTML / CSS / JavaScript，可直接部署到 GitHub Pages，不需要 Node.js 常駐伺服器。

## v3 功能

- 單欄灰白色介面，順序：Today → 月曆 → 每月預估收入 → 同步狀態。
- 右下角小型快捷按鈕：單次排班、固定排班、同步設定。
- 排班類別：早診、午診、晚診、支援、健檢、月中、疫苗、其他。
- 「其他」可自訂類別名稱。
- 每一班可選顏色標記；月曆與 Today 只以色點/左側色條呈現，維持灰白主視覺。
- 固定排班可一次建立 1、2、6、12 個月或自訂日期範圍。
- 每節可設定不同節費。
- 每月收入：牌費 + 當月節費 + PPF + 額外支援收入 - 健保費用。
- Google Calendar 雙向讀寫（網站新增/修改/刪除後寫入 Google；重新整理可讀回 Google 的修改）。
- Apple Calendar 可透過 Google Calendar 的 Secret iCal URL 訂閱。

## GitHub Pages

將以下檔案放在 repository 根目錄：

- index.html
- styles.css
- app.js
- .nojekyll

Settings → Pages → Deploy from a branch → main / root。

## Google Calendar

在同步設定輸入：

1. Google OAuth Client ID
2. 排班專用 Calendar ID
3. Apple Calendar 使用的 Secret iCal URL（可選）

Google OAuth Web Application 的 Authorized JavaScript origin 要設定為 GitHub Pages 網域，例如：

`https://你的帳號.github.io`

不要把 Client secret 或 Secret iCal URL 寫進 repository。

## 顏色資料

排班顏色與類別會寫在 Google Calendar event 的 `extendedProperties.private` 中，因此本網站重新讀取事件時可還原顏色與收入用節費。

## v4：收入設定跨裝置同步
牌費、PPF、額外支援收入、健保費用不再只依賴單一瀏覽器。儲存時會在同一本 Google Calendar 建立一筆 `收入設定｜YYYY-MM` 的全天透明事件，數值放在事件的 private extended properties；網站同步時會讀回並隱藏這類事件，不會當成排班顯示。Google Calendar 本身仍會看得到該筆「收入設定」全天事件。
