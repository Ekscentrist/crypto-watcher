import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import initSqlJs from 'sql.js';
import { migrateLegacyTradesToLots } from '../src/portfolio.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

/** @type {import('sql.js').Database | null} */
let db = null;
/** @type {string | null} */
let dbPath = null;

/** Canonical DB location: %APPDATA%/crypto-watcher/data/watcher.db (packaged + dev). */
export function getDbPath() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'watcher.db');
}

function legacyDbCandidates() {
  return [
    // Previous project-local path (dev)
    path.join(PROJECT_ROOT, 'data', 'watcher.db'),
  ];
}

function migrateDbFileIfNeeded(targetPath) {
  if (fs.existsSync(targetPath)) return;
  for (const legacy of legacyDbCandidates()) {
    if (!fs.existsSync(legacy)) continue;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(legacy, targetPath);
    return;
  }
}

/** Prefer asar.unpacked path so WebAssembly can load the file on disk. */
function resolveSqlWasmPath() {
  const resolved = require.resolve('sql.js/dist/sql-wasm.wasm');
  const marker = `${path.sep}app.asar${path.sep}`;
  const unpackedMarker = `${path.sep}app.asar.unpacked${path.sep}`;
  if (resolved.includes(marker) && !resolved.includes(unpackedMarker)) {
    const unpacked = resolved.replace(marker, unpackedMarker);
    if (fs.existsSync(unpacked)) return unpacked;
  }
  return resolved;
}

function persist() {
  if (!db || !dbPath) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function run(sql, params = []) {
  db.run(sql, params);
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function tableColumns(table) {
  return all(`PRAGMA table_info(${table})`).map((c) => String(c.name));
}

function migrateTradesSchemaToLots() {
  const cols = tableColumns('trades');
  if (!cols.includes('sell_price')) {
    run('ALTER TABLE trades ADD COLUMN sell_price REAL');
  }
  if (!cols.includes('sell_time')) {
    run('ALTER TABLE trades ADD COLUMN sell_time INTEGER');
  }
  if (!cols.includes('staked')) {
    run('ALTER TABLE trades ADD COLUMN staked INTEGER NOT NULL DEFAULT 0');
  }

  if (getMeta('lots_model_v1', '0') === '1') {
    persist();
    return;
  }

  const raw = all(
    `SELECT id, coin_id AS coinId, symbol, side, qty, price, time,
            sell_price AS sellPrice, sell_time AS sellTime, staked
     FROM trades`,
  );

  const mapped = raw.map((t) => ({
    id: String(t.id),
    coinId: String(t.coinId),
    symbol: String(t.symbol || ''),
    side: String(t.side || 'buy'),
    qty: Number(t.qty),
    price: Number(t.price),
    time: Number(t.time),
    sellPrice: t.sellPrice == null || t.sellPrice === '' ? null : Number(t.sellPrice),
    sellTime: t.sellTime == null || t.sellTime === '' ? null : Number(t.sellTime),
    staked: Boolean(Number(t.staked)),
  }));

  const hasLegacySells = mapped.some((t) => t.side === 'sell');
  const lots = hasLegacySells
    ? migrateLegacyTradesToLots(mapped)
    : mapped
        .filter((t) => t.side !== 'sell')
        .map((t) => ({
          id: t.id,
          coinId: t.coinId,
          symbol: t.symbol,
          qty: t.qty,
          price: t.price,
          time: t.time,
          sellPrice: t.sellPrice,
          sellTime: t.sellTime,
          staked: Boolean(t.staked),
        }));

  run('DELETE FROM trades');
  for (const t of lots) {
    run(
      'INSERT INTO trades (id, coin_id, symbol, side, qty, price, time, sell_price, sell_time, staked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        t.id,
        t.coinId,
        String(t.symbol || '').toLowerCase(),
        'buy',
        Number(t.qty),
        Number(t.price),
        Number(t.time),
        t.sellPrice == null ? null : Number(t.sellPrice),
        t.sellTime == null ? null : Number(t.sellTime),
        t.staked ? 1 : 0,
      ],
    );
  }

  setMeta('lots_model_v1', '1');
  persist();
}

export async function openDatabase() {
  if (db) return db;

  dbPath = getDbPath();
  migrateDbFileIfNeeded(dbPath);

  const wasmPath = resolveSqlWasmPath();
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  run(`
    CREATE TABLE IF NOT EXISTS coins (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  run(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      coin_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'buy',
      qty REAL NOT NULL,
      price REAL NOT NULL,
      time INTEGER NOT NULL,
      sell_price REAL,
      sell_time INTEGER,
      staked INTEGER NOT NULL DEFAULT 0
    );
  `);
  run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(time);`);
  run(`CREATE INDEX IF NOT EXISTS idx_trades_coin ON trades(coin_id);`);

  migrateTradesSchemaToLots();
  persist();
  return db;
}

export function closeDatabase() {
  if (db) {
    try {
      persist();
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
}

function getMeta(key, fallback = null) {
  const row = get('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? String(row.value) : fallback;
}

function setMeta(key, value) {
  run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)],
  );
  persist();
}

export function getState() {
  const coinRows = all(
    'SELECT id, symbol, name, sort_order FROM coins ORDER BY sort_order ASC, symbol ASC',
  );
  const tradeRows = all(
    `SELECT id, coin_id AS coinId, symbol, qty, price, time,
            sell_price AS sellPrice, sell_time AS sellTime, staked
     FROM trades
     ORDER BY time ASC, id ASC`,
  );

  const peak = Number(getMeta('peak_equity', '0')) || 0;
  const alwaysOnTop = getMeta('always_on_top', '0') === '1';
  const migrated = getMeta('migrated_from_localstorage', '0') === '1';

  return {
    dbPath: getDbPath(),
    migrated,
    peakEquity: peak,
    alwaysOnTop,
    coins: coinRows.map((c) => ({
      id: String(c.id),
      symbol: String(c.symbol),
      name: String(c.name),
    })),
    trades: tradeRows.map((t) => ({
      id: String(t.id),
      coinId: String(t.coinId),
      symbol: String(t.symbol),
      qty: Number(t.qty),
      price: Number(t.price),
      time: Number(t.time),
      sellPrice: t.sellPrice == null || t.sellPrice === '' ? null : Number(t.sellPrice),
      sellTime: t.sellTime == null || t.sellTime === '' ? null : Number(t.sellTime),
      staked: Boolean(Number(t.staked)),
    })),
  };
}

export function saveCoins(coins) {
  run('DELETE FROM coins');
  const list = Array.isArray(coins) ? coins : [];
  list.forEach((c, i) => {
    run('INSERT INTO coins (id, symbol, name, sort_order) VALUES (?, ?, ?, ?)', [
      c.id,
      String(c.symbol || '').toLowerCase(),
      String(c.name || c.id),
      i,
    ]);
  });
  persist();
  return getState();
}

export function saveTrades(trades) {
  run('DELETE FROM trades');
  const list = Array.isArray(trades) ? trades : [];
  for (const t of list) {
    run(
      'INSERT INTO trades (id, coin_id, symbol, side, qty, price, time, sell_price, sell_time, staked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        String(t.id),
        String(t.coinId),
        String(t.symbol || '').toLowerCase(),
        'buy',
        Number(t.qty),
        Number(t.price),
        Number(t.time) || Date.now(),
        t.sellPrice == null || t.sellPrice === '' ? null : Number(t.sellPrice),
        t.sellTime == null || t.sellTime === '' ? null : Number(t.sellTime),
        t.staked ? 1 : 0,
      ],
    );
  }
  persist();
  return getState();
}

export function setPeakEquity(value) {
  setMeta('peak_equity', Number(value) || 0);
  return Number(getMeta('peak_equity', '0')) || 0;
}

export function setAlwaysOnTopPref(enabled) {
  setMeta('always_on_top', enabled ? '1' : '0');
  return Boolean(enabled);
}

export function migrateFromLocalStorage(payload) {
  const state = getState();
  const hasData = state.coins.length > 0 || state.trades.length > 0;
  if (state.migrated || hasData) {
    return { ok: true, skipped: true, ...getState() };
  }

  const coins = Array.isArray(payload?.coins) ? payload.coins : [];
  let trades = Array.isArray(payload?.trades) ? payload.trades : [];
  const peak = Number(payload?.peakEquity) || 0;
  const alwaysOnTop = Boolean(payload?.alwaysOnTop);

  if (trades.some((t) => t.side === 'sell')) {
    trades = migrateLegacyTradesToLots(trades);
  } else {
    trades = trades.map((t) => ({
      id: String(t.id),
      coinId: String(t.coinId),
      symbol: String(t.symbol || ''),
      qty: Number(t.qty),
      price: Number(t.price),
      time: Number(t.time) || Date.now(),
      sellPrice: t.sellPrice == null ? null : Number(t.sellPrice),
      sellTime: t.sellTime == null ? null : Number(t.sellTime),
      staked: Boolean(t.staked),
    }));
  }

  if (coins.length) saveCoins(coins);
  if (trades.length) saveTrades(trades);
  if (peak > 0) setPeakEquity(peak);
  setAlwaysOnTopPref(alwaysOnTop);
  setMeta('migrated_from_localstorage', '1');
  setMeta('lots_model_v1', '1');

  return { ok: true, skipped: false, ...getState() };
}

export function seedDefaultsIfEmpty(defaultCoins) {
  const state = getState();
  if (state.coins.length === 0 && state.trades.length === 0 && !state.migrated) {
    return state;
  }
  if (state.coins.length === 0 && state.trades.length === 0 && state.migrated) {
    saveCoins(defaultCoins);
    return getState();
  }
  return state;
}

export function ensureCoins(defaultCoins) {
  const state = getState();
  if (state.coins.length === 0) {
    saveCoins(defaultCoins);
    setMeta('migrated_from_localstorage', '1');
    return getState();
  }
  if (!state.migrated) {
    setMeta('migrated_from_localstorage', '1');
  }
  return getState();
}
