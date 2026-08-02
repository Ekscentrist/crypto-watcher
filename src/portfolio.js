/**
 * Lot-based spot portfolio: each buy is a lot; sell closes that lot in place.
 */

/** @type {readonly string[]} */
export const EXCHANGES = Object.freeze(['OKX', 'Bitget', 'Gate']);

/**
 * @typedef {{
 *   id: string,
 *   coinId: string,
 *   symbol: string,
 *   qty: number,
 *   price: number,
 *   time: number,
 *   sellPrice?: number|null,
 *   sellTime?: number|null,
 *   staked?: boolean,
 *   exchange?: string|null,
 * }} Trade
 *
 * @typedef {{
 *   coinId: string,
 *   qty: number,
 *   avgCost: number,
 *   costBasis: number,
 *   realizedPnl: number,
 *   boughtQty: number,
 *   soldQty: number,
 *   openLots: number,
 * }} PositionBase
 *
 * @typedef {PositionBase & {
 *   marketValue: number|null,
 *   unrealizedPnl: number|null,
 *   mark: number|null,
 * }} Position
 */

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeExchange(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return EXCHANGES.includes(s) ? s : null;
}

/**
 * Default exchange for new buys when none saved yet.
 * @param {unknown} value
 * @returns {string}
 */
export function defaultExchange(value) {
  return normalizeExchange(value) || EXCHANGES[0];
}

export function isOpen(trade) {
  return trade.sellPrice == null || Number.isNaN(Number(trade.sellPrice));
}

export function isStaked(trade) {
  return Boolean(trade?.staked);
}

/** Open lot that still counts in Active list and portfolio stats. */
export function isActiveOpen(trade) {
  return isOpen(trade) && !isStaked(trade);
}

export function lotRealizedPnl(trade) {
  if (isOpen(trade)) return null;
  return (Number(trade.sellPrice) - Number(trade.price)) * Number(trade.qty);
}

export function lotUnrealizedPnl(trade, mark) {
  if (!isActiveOpen(trade) || mark == null) return null;
  return (Number(mark) - Number(trade.price)) * Number(trade.qty);
}

/**
 * Aggregate open lots (+ realized from closed) per coin.
 * Staked lots are excluded from all stats.
 * @param {Trade[]} trades
 * @returns {{ positions: Map<string, PositionBase>, error: string|null }}
 */
export function rebuildPositions(trades) {
  /** @type {Map<string, PositionBase>} */
  const positions = new Map();

  for (const t of trades) {
    const qty = Number(t.qty);
    const price = Number(t.price);
    if (!(qty > 0) || !(price > 0)) {
      return { positions, error: `Invalid trade ${t.id}` };
    }

    if (isStaked(t)) continue;

    let pos = positions.get(t.coinId);
    if (!pos) {
      pos = {
        coinId: t.coinId,
        qty: 0,
        avgCost: 0,
        costBasis: 0,
        realizedPnl: 0,
        boughtQty: 0,
        soldQty: 0,
        openLots: 0,
      };
      positions.set(t.coinId, pos);
    }

    pos.boughtQty += qty;

    if (isOpen(t)) {
      pos.qty += qty;
      pos.costBasis += qty * price;
      pos.openLots += 1;
    } else {
      pos.soldQty += qty;
      pos.realizedPnl += lotRealizedPnl(t) ?? 0;
    }
  }

  for (const pos of positions.values()) {
    pos.avgCost = pos.qty > 0 ? pos.costBasis / pos.qty : 0;
  }

  return { positions, error: null };
}

/**
 * Aggregate only open staked lots per coin (for Staked tab summary).
 * @param {Trade[]} trades
 * @returns {{ positions: Map<string, PositionBase>, error: string|null }}
 */
export function rebuildStakedPositions(trades) {
  /** @type {Map<string, PositionBase>} */
  const positions = new Map();

  for (const t of trades) {
    if (!isOpen(t) || !isStaked(t)) continue;

    const qty = Number(t.qty);
    const price = Number(t.price);
    if (!(qty > 0) || !(price > 0)) {
      return { positions, error: `Invalid trade ${t.id}` };
    }

    let pos = positions.get(t.coinId);
    if (!pos) {
      pos = {
        coinId: t.coinId,
        qty: 0,
        avgCost: 0,
        costBasis: 0,
        realizedPnl: 0,
        boughtQty: 0,
        soldQty: 0,
        openLots: 0,
      };
      positions.set(t.coinId, pos);
    }

    pos.boughtQty += qty;
    pos.qty += qty;
    pos.costBasis += qty * price;
    pos.openLots += 1;
  }

  for (const pos of positions.values()) {
    pos.avgCost = pos.qty > 0 ? pos.costBasis / pos.qty : 0;
  }

  return { positions, error: null };
}

/**
 * @param {Map<string, PositionBase>} positions
 * @param {Map<string, number>|Record<string, number>} marks
 * @returns {Map<string, Position>}
 */
export function applyMarks(positions, marks) {
  const getMark = (id) => {
    if (marks instanceof Map) return marks.has(id) ? marks.get(id) : null;
    return marks?.[id] ?? null;
  };

  /** @type {Map<string, Position>} */
  const out = new Map();
  for (const [id, pos] of positions) {
    const mark = getMark(id);
    const marketValue = mark != null && pos.qty > 0 ? mark * pos.qty : pos.qty > 0 ? null : 0;
    const unrealizedPnl =
      mark != null && pos.qty > 0 ? marketValue - pos.costBasis : pos.qty > 0 ? null : 0;
    out.set(id, {
      ...pos,
      mark: mark ?? null,
      marketValue,
      unrealizedPnl,
    });
  }
  return out;
}

/**
 * @param {Map<string, Position>} positions
 */
export function computeSummary(positions) {
  let costBasis = 0;
  let realizedPnl = 0;
  let equityKnown = true;
  let equity = 0;
  let unrealized = 0;

  for (const pos of positions.values()) {
    costBasis += pos.costBasis;
    realizedPnl += pos.realizedPnl;
    if (pos.qty <= 0) continue;
    if (pos.marketValue == null || pos.unrealizedPnl == null) {
      equityKnown = false;
    } else {
      equity += pos.marketValue;
      unrealized += pos.unrealizedPnl;
    }
  }

  const equityValue = equityKnown ? equity : null;
  const unrealizedPnl = equityKnown ? unrealized : null;
  const totalPnl = equityKnown ? realizedPnl + unrealized : null;

  return {
    equity: equityValue,
    costBasis,
    unrealizedPnl,
    realizedPnl,
    totalPnl,
  };
}

/**
 * @param {{ qty: number, price: number }} draft
 */
export function validateBuy(draft) {
  const qty = Number(draft.qty);
  const price = Number(draft.price);
  if (!(qty > 0)) return { ok: false, message: 'Quantity must be > 0' };
  if (!(price > 0)) return { ok: false, message: 'Price must be > 0' };
  return { ok: true, message: '' };
}

/**
 * @param {Trade|null|undefined} trade
 * @param {number} sellPrice
 */
export function validateClose(trade, sellPrice) {
  if (!trade) return { ok: false, message: 'Trade not found' };
  if (!isOpen(trade)) return { ok: false, message: 'Trade already closed' };
  if (isStaked(trade)) return { ok: false, message: 'Unstake before selling' };
  const price = Number(sellPrice);
  if (!(price > 0)) return { ok: false, message: 'Sell price must be > 0' };
  return { ok: true, message: '' };
}

/**
 * Close a buy lot in place. Returns new trades array.
 * @param {Trade[]} trades
 * @param {string} tradeId
 * @param {number} sellPrice
 * @param {number} [sellTime]
 * @returns {{ trades: Trade[], error: string|null, closed: Trade|null }}
 */
export function closeLot(trades, tradeId, sellPrice, sellTime = Date.now()) {
  const idx = trades.findIndex((t) => t.id === tradeId);
  if (idx < 0) return { trades, error: 'Trade not found', closed: null };
  const trade = trades[idx];
  const check = validateClose(trade, sellPrice);
  if (!check.ok) return { trades, error: check.message, closed: null };

  const closed = {
    ...trade,
    staked: false,
    sellPrice: Number(sellPrice),
    sellTime: Number(sellTime) || Date.now(),
  };
  const next = [...trades];
  next[idx] = closed;
  return { trades: next, error: null, closed };
}

/**
 * @param {Trade[]} trades
 * @param {string} tradeId
 * @returns {{ trades: Trade[], error: string|null }}
 */
export function stakeLot(trades, tradeId) {
  const idx = trades.findIndex((t) => t.id === tradeId);
  if (idx < 0) return { trades, error: 'Trade not found' };
  const trade = trades[idx];
  if (!isOpen(trade)) return { trades, error: 'Only open trades can be staked' };
  if (isStaked(trade)) return { trades, error: 'Trade already staked' };
  const next = [...trades];
  next[idx] = { ...trade, staked: true };
  return { trades: next, error: null };
}

/**
 * @param {Trade[]} trades
 * @param {string} tradeId
 * @returns {{ trades: Trade[], error: string|null }}
 */
export function unstakeLot(trades, tradeId) {
  const idx = trades.findIndex((t) => t.id === tradeId);
  if (idx < 0) return { trades, error: 'Trade not found' };
  const trade = trades[idx];
  if (!isStaked(trade)) return { trades, error: 'Trade is not staked' };
  const next = [...trades];
  next[idx] = { ...trade, staked: false };
  return { trades: next, error: null };
}

/**
 * @param {Trade[]} trades
 * @param {string} tradeId
 * @param {unknown} exchange
 * @returns {{ trades: Trade[], error: string|null }}
 */
export function setTradeExchange(trades, tradeId, exchange) {
  const idx = trades.findIndex((t) => t.id === tradeId);
  if (idx < 0) return { trades, error: 'Trade not found' };
  const normalized = normalizeExchange(exchange);
  if (!normalized) return { trades, error: 'Choose OKX, Bitget, or Gate' };
  const next = [...trades];
  next[idx] = { ...trades[idx], exchange: normalized };
  return { trades: next, error: null };
}

/**
 * Normalize legacy buy/sell rows into lot model (FIFO match sells onto buys).
 * @param {Array<Trade & { side?: string }>} rows
 * @returns {Trade[]}
 */
export function migrateLegacyTradesToLots(rows) {
  const sorted = [...rows].sort(
    (a, b) => Number(a.time) - Number(b.time) || String(a.id).localeCompare(String(b.id)),
  );

  /** @type {Trade[]} */
  const lots = [];
  /** @type {Map<string, Trade[]>} open buys per coin, mutable qty for FIFO */
  const openByCoin = new Map();

  const pushOpen = (lot) => {
    lots.push(lot);
    if (!openByCoin.has(lot.coinId)) openByCoin.set(lot.coinId, []);
    openByCoin.get(lot.coinId).push(lot);
  };

  for (const row of sorted) {
    const side = row.side === 'sell' ? 'sell' : 'buy';
    const qty = Number(row.qty);
    const price = Number(row.price);
    const time = Number(row.time) || Date.now();
    if (!(qty > 0) || !(price > 0)) continue;

    if (side === 'buy') {
      // Already lot-shaped with sellPrice
      if (row.sellPrice != null && !Number.isNaN(Number(row.sellPrice))) {
        lots.push({
          id: String(row.id),
          coinId: String(row.coinId),
          symbol: String(row.symbol || '').toLowerCase(),
          qty,
          price,
          time,
          sellPrice: Number(row.sellPrice),
          sellTime: row.sellTime != null ? Number(row.sellTime) : time,
        });
        continue;
      }
      pushOpen({
        id: String(row.id),
        coinId: String(row.coinId),
        symbol: String(row.symbol || '').toLowerCase(),
        qty,
        price,
        time,
        sellPrice: null,
        sellTime: null,
      });
      continue;
    }

    // Legacy sell: FIFO against open buys
    let remaining = qty;
    const queue = openByCoin.get(String(row.coinId)) || [];
    while (remaining > 1e-12 && queue.length) {
      const open = queue[0];
      const take = Math.min(remaining, open.qty);
      if (take >= open.qty - 1e-12) {
        open.sellPrice = price;
        open.sellTime = time;
        open.qty = Number(open.qty);
        queue.shift();
        remaining -= take;
      } else {
        // Split: close portion, keep remainder open
        const closedId = `${open.id}-c-${time}`;
        const closed = {
          id: closedId,
          coinId: open.coinId,
          symbol: open.symbol,
          qty: take,
          price: open.price,
          time: open.time,
          sellPrice: price,
          sellTime: time,
        };
        lots.push(closed);
        open.qty = open.qty - take;
        remaining -= take;
      }
    }
  }

  return lots.map((t) => ({
    id: t.id,
    coinId: t.coinId,
    symbol: t.symbol,
    qty: Number(t.qty),
    price: Number(t.price),
    time: Number(t.time),
    sellPrice: t.sellPrice == null ? null : Number(t.sellPrice),
    sellTime: t.sellTime == null ? null : Number(t.sellTime),
    staked: Boolean(t.staked),
    exchange: normalizeExchange(t.exchange),
  }));
}

/** @deprecated use validateBuy / validateClose */
export function validateTrade(existing, draft) {
  if (draft.side === 'buy') return validateBuy(draft);
  return { ok: false, message: 'Use Sell on an open buy trade' };
}
