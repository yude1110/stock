# 即時股票追蹤器（台股 / 美股）

給交易員用的看盤與分析網站：即時行情、今日焦點（漲跌原因）、個股完整分析（技術面 / 基本面 / 籌碼面 / 消息面）、翻譯與摘要，以及可替換券商的下單介面（目前為模擬交易）。

## 啟動

雙擊 `start.bat`，或：

```
npm install
node server.js
```

開啟 http://localhost:3000 。

| 頁面 | 說明 |
|---|---|
| `/` | 儀表板：大盤、今日焦點、自選股、排行、ETF、新聞 |
| `/stock.html?symbol=2330.TW` | 個股分析：K 線與指標、技術面總評、支撐壓力、基本面、籌碼面、消息面、下單、帳戶 |

## 環境變數（皆為選用）

| 變數 | 用途 |
|---|---|
| `PORT` | 埠號，預設 3000 |
| `HOST` | 預設 `127.0.0.1`（只允許本機連線，因為有下單功能）；設 `0.0.0.0` 開放區網 |
| `FINMIND_TOKEN` | FinMind API token。未設定時免費額度約每小時 300 次，台股籌碼 / 月營收看太多檔可能用完 |
| `ANTHROPIC_API_KEY` | 設定後新聞摘要改用 Claude 撰寫；未設定時使用重點句擷取 |

## 架構

```
server.js            HTTP 路由、行情（Yahoo / Yahoo 奇摩）、排行、新聞
translate.js         翻譯（Google 翻譯）與摘要（Claude 或抽取式）
lib/http.js          共用抓取 + 快取
lib/indicators.js    技術指標：MA、布林、RSI、MACD、KD、ATR、乖離、OBV、訊號、支撐壓力
lib/fundamentals.js  基本面：估值、季度 / 年度財報、成長、體質、月營收、股利、本益比位階
lib/chips.js         籌碼面：三大法人、融資融券、外資持股、當沖率；美股機構持股、放空、內部人
lib/broker.js        交易介面（Broker Adapter）+ 模擬交易實作
public/              前端（index.html 儀表板、stock.html 個股分析、common.js / base.css 共用）
data/                模擬帳戶資料
```

## 串接真實券商 / 交易所

`lib/broker.js` 定義了前端使用的交易介面：

- `info()`：券商名稱、支援市場、委託類型
- `account()`：現金、持倉、損益
- `orders()`：委託與成交紀錄
- `placeOrder({ symbol, side, type, qty, price })`
- `cancelOrder(id)`

要接真實券商（例如永豐 Shioaji、富邦 Neo、元大、Interactive Brokers、Alpaca），新增一個實作相同方法的 adapter，並在 `server.js` 中依環境變數選用即可，前端不需修改。上線真實交易前務必加入：身分驗證、下單風控（單筆上限、價格偏離檢查、漲跌停 / 升降單位檢查）、委託回報同步與錯誤處理。

## 資料來源

Yahoo Finance、Yahoo 奇摩股市、FinMind、Nasdaq、鉅亨網、Google 新聞、Google 翻譯。皆為公開但非正式授權的端點，對方改版時可能需要調整。技術訊號為機械式規則判讀，僅供參考，不構成投資建議。
