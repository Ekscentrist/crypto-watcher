# Crypto Watcher

Простое Windows-приложение: живые цены крипты + спот-учёт (Buy/Sell, PnL). Данные в **SQLite**.

## Требования

- [Node.js](https://nodejs.org/) (LTS)
- Windows (сборка и запуск ориентированы на Win)

## Запуск

```bash
npm install
npm start
```

Или двойной клик по `start.bat`.

## Сборка установщика

```bash
npm run dist
```

Артефакты появятся в папке `release/` (NSIS-установщик и portable).

## Где лежат данные (SQLite)

Файл:

`%APPDATA%\crypto-watcher\data\watcher.db`

Таблицы: `coins`, `trades`, `meta` (peak equity, always-on-top).

Если раньше БД лежала в папке проекта (`data/watcher.db`), при первом запуске она скопируется в AppData автоматически.

## Цены

- USD + изменение за 24ч ([CoinGecko](https://www.coingecko.com/) public API, ключ не нужен)
- Обновление каждые 20 сек
- Поиск монет, Always on top

## Спот

Вкладки **Prices** (тикер + **Buy**) и **Portfolio** (открытые покупки + закрытая история).

Каждый **Buy** — отдельный трейд. Кнопка **Sell** на открытом трейде закрывает **ровно этот лот** по введённой цене (отдельных sell-записей нет).

## Стек

Electron + Vite + vanilla JS + **sql.js** (SQLite-файл без Visual Studio / native build).

## Лицензия

MIT
