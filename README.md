# 個人排班行事曆 v4.5.1

此版本只修正 v4.5 的「批次刪除按鈕按不下去」問題，其餘架構、版面與資料同步方式不變。

## 修正內容

1. GitHub Pages 靜態資源加上版本號
   - `styles.css?v=4.5.1`
   - `app.js?v=4.5.1`
   - 避免更新 `index.html` 後，瀏覽器仍沿用舊版 `app.js`，造成新按鈕顯示但沒有 JavaScript handler。

2. 批次刪除按鈕改用事件委派
   - 不再只依賴單一 `onclick` 屬性。
   - 手機 / 桌面瀏覽器皆使用同一套 click 流程。

3. 強化點擊區
   - 明確設定 `pointer-events: auto`
   - `touch-action: manipulation`
   - 保持浮動工具列在 modal 之下，不影響原有彈窗遮罩。

## 批次刪除操作

- 點右下角「☑ 批次刪除」
- 月曆事件進入可勾選狀態
- 點選多筆事件
- 按鈕顯示「刪除已選 (N)」
- 再按一次並確認後，會同步刪除 Google Calendar 對應事件

若進入批次模式後尚未選取任何事件，再按一次按鈕會取消批次刪除模式。

## GitHub Pages 更新

請至少覆蓋：
- `index.html`
- `app.js`
- `styles.css`

然後 Commit。v4.5.1 已使用 query-string cache busting，正常重新開啟頁面即可載入新版 JavaScript。
