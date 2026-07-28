# Crypto Watcher

A simple Windows desktop app: live crypto prices + spot tracking (Buy/Sell, PnL). Data stored in **SQLite**.

[English](#english) · [Русский](#русский)

---

## English

### Requirements

- [Node.js](https://nodejs.org/) (LTS)
- Windows (run and build targets are Windows-focused)

### Run

```bash
npm install
npm start
```

Or double-click `start.bat`.

### Build installer

```bash
npm run dist
```

Artifacts go to `release/` (NSIS installer and portable build).

### Data location (SQLite)

File:

`%APPDATA%\crypto-watcher\data\watcher.db`

Tables: `coins`, `trades`, `meta` (peak equity, always-on-top).

If an older DB lived in the project folder (`data/watcher.db`), it is copied to AppData on first launch.

### Prices

- USD + 24h change ([CoinGecko](https://www.coingecko.com/) public API, no key required)
- Refresh every 20 seconds
- Coin search, Always on top

### Spot

Tabs: **Prices** (ticker + **Buy**) and **Portfolio** (open lots + closed history).

Each **Buy** is a separate trade. **Sell** on an open trade closes **exactly that lot** at the entered price (no separate sell records).

### Stack

Electron + Vite + vanilla JS + **sql.js** (SQLite file without Visual Studio / native build).

### License

MIT

---

## Русский

Простое Windows-приложение: живые цены крипты + спот-учёт (Buy/Sell, PnL). Данные в **SQLite**.

### Требования

- [Node.js](https://nodejs.org/) (LTS)
- Windows (сборка и запуск ориентированы на Win)

### Запуск

```bash
npm install
npm start
```

Или двойной клик по `start.bat`.

### Сборка установщика

```bash
npm run dist
```

Артефакты появятся в папке `release/` (NSIS-установщик и portable).

### Где лежат данные (SQLite)

Файл:

`%APPDATA%\crypto-watcher\data\watcher.db`

Таблицы: `coins`, `trades`, `meta` (peak equity, always-on-top).

Если раньше БД лежала в папке проекта (`data/watcher.db`), при первом запуске она скопируется в AppData автоматически.

### Цены

- USD + изменение за 24ч ([CoinGecko](https://www.coingecko.com/) public API, ключ не нужен)
- Обновление каждые 20 сек
- Поиск монет, Always on top

### Спот

Вкладки **Prices** (тикер + **Buy**) и **Portfolio** (открытые покупки + закрытая история).

Каждый **Buy** — отдельный трейд. Кнопка **Sell** на открытом трейде закрывает **ровно этот лот** по введённой цене (отдельных sell-записей нет).

### Стек

Electron + Vite + vanilla JS + **sql.js** (SQLite-файл без Visual Studio / native build).

### Лицензия

MIT
