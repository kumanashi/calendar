# 個人排班行事曆 v4.9

v4.9 以 v4.8.1 為底，Google Calendar、Drive App Data、PIN、背景圖片、診次種類、批次刪除、固定排班等原有架構不變。

## 1. 禁止頁面縮放
- viewport 加入 `maximum-scale=1, user-scalable=no`
- 強化 mobile / desktop overflow 控制
- input / select / textarea 在手機維持 16px，避免 iOS 聚焦時自動放大
- modal 最大高度使用 `100dvh`，內容超出時在視窗內捲動
- 小螢幕表單改為單欄，按鈕與 floating actions 保持在可操作範圍

## 2. 進入「設定」需再次輸入 PIN
- 每次按右下角「設定」，先跳出 PIN 驗證視窗
- PIN 驗證成功後才開啟設定
- 不新增第二組 PIN，沿用登入首頁的同一組 verifier

## 3. 收入統計
Estimate Income 區新增「收入統計」：
- 實際上班天數：同一天有至少 1 節班即計 1 天
- 總班數
- 總時數：依每一節開始 / 結束時間計算
- 平均每工作日預估收入
- 節費分布：例如 NT$ 6,500 有幾節、占比多少
- 收入項目比例：牌費 / 節費 / PPF / 額外支援；健保費用獨立標示為扣除
- 歷月預估收入折線圖：依已同步的排班月份與每月收入設定計算

## 4. 螢幕適配
針對 320px–桌面寬度調整：
- modal 寬高
- 表單欄位
- 設定頁
- 診次種類管理
- 背景圖片設定
- 收入統計與折線圖
- floating actions
- Google / Apple 按鈕

## 更新 GitHub Pages
覆蓋：
- index.html
- app.js
- styles.css
- robots.txt
- .nojekyll

v4.9 使用 `app.js?v=4.9` 與 `styles.css?v=4.9`。
