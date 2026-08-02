import {
  applyMarks,
  closeLot,
  computeSummary,
  defaultExchange,
  EXCHANGES,
  isActiveOpen,
  isOpen,
  isStaked,
  lotRealizedPnl,
  lotUnrealizedPnl,
  normalizeExchange,
  rebuildPositions,
  setTradeExchange,
  stakeLot,
  unstakeLot,
  validateBuy,
  validateClose,
} from './portfolio.js';

const LEGACY_COINS_KEY = 'crypto-watcher-coins-v1';
const LEGACY_TRADES_KEY = 'crypto-watcher-trades-v1';
const LEGACY_PEAK_KEY = 'crypto-watcher-peak-equity-v1';
const LEGACY_AOT_KEY = 'crypto-watcher-always-on-top';
const POLL_MS = 20_000;

const coinListEl = document.getElementById('coinList');
const emptyStateEl = document.getElementById('emptyState');
const statusTextEl = document.getElementById('statusText');
const refreshBtn = document.getElementById('refreshBtn');
const addCoinBtn = document.getElementById('addCoinBtn');
const alwaysOnTopEl = document.getElementById('alwaysOnTop');
const addDialog = document.getElementById('addDialog');
const coinSearchEl = document.getElementById('coinSearch');
const searchResultsEl = document.getElementById('searchResults');

const pagePricesEl = document.getElementById('pagePrices');
const pagePortfolioEl = document.getElementById('pagePortfolio');
const pageStakedEl = document.getElementById('pageStaked');
const activeListEl = document.getElementById('activeList');
const activeEmptyEl = document.getElementById('activeEmpty');
const historyListEl = document.getElementById('historyList');
const historyEmptyEl = document.getElementById('historyEmpty');
const portfolioFilterBar = document.getElementById('portfolioFilterBar');
const portfolioFilterLabel = document.getElementById('portfolioFilterLabel');
const portfolioFilterClear = document.getElementById('portfolioFilterClear');
const stakedListEl = document.getElementById('stakedList');
const stakedEmptyEl = document.getElementById('stakedEmpty');
const stakedFilterBar = document.getElementById('stakedFilterBar');
const stakedFilterLabel = document.getElementById('stakedFilterLabel');
const stakedFilterClear = document.getElementById('stakedFilterClear');

const sumEquityEl = document.getElementById('sumEquity');
const sumUnrealEl = document.getElementById('sumUnreal');
const sumRealEl = document.getElementById('sumReal');
const sumTotalEl = document.getElementById('sumTotal');

const tradeDialog = document.getElementById('tradeDialog');
const tradeForm = document.getElementById('tradeForm');
const tradeTitle = document.getElementById('tradeTitle');
const tradeQty = document.getElementById('tradeQty');
const tradePrice = document.getElementById('tradePrice');
const tradeError = document.getElementById('tradeError');
const tradeCancel = document.getElementById('tradeCancel');
const tradeHint = document.getElementById('tradeHint');
const tradePreview = document.getElementById('tradePreview');
const tradeSuccess = document.getElementById('tradeSuccess');
const tradeQtyField = document.getElementById('tradeQtyField');
const tradePriceLabel = document.getElementById('tradePriceLabel');
const tradeSubmit = document.getElementById('tradeSubmit');
const tradeExchangeField = document.getElementById('tradeExchangeField');
const tradeExchange = document.getElementById('tradeExchange');
const exchangeDialog = document.getElementById('exchangeDialog');
const exchangeForm = document.getElementById('exchangeForm');
const exchangeSelect = document.getElementById('exchangeSelect');
const exchangeError = document.getElementById('exchangeError');
const exchangeCancel = document.getElementById('exchangeCancel');
const exchangeSubmit = document.getElementById('exchangeSubmit');
const confirmDialog = document.getElementById('confirmDialog');
const confirmForm = document.getElementById('confirmForm');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOk = document.getElementById('confirmOk');

/** @type {{ id: string, symbol: string, name: string }[]} */
let coins = [];
/** @type {import('./portfolio.js').Trade[]} */
let trades = [];
let dbPath = '';
/** @type {string} */
let lastExchange = EXCHANGES[0];
/** @type {Map<string, any>} */
let marketById = new Map();
/** @type {Map<string, import('./portfolio.js').Position>} */
let positionsById = new Map();

let lastUpdatedAt = null;
let pollTimer = null;
let searchTimer = null;
let fetching = false;
/** @type {'prices' | 'portfolio' | 'staked'} */
let currentPage = 'prices';
/** @type {string | null} */
let portfolioFilterCoinId = null;
/** @type {string | null} */
let portfolioFilterExchange = null;
/** @type {'buy' | 'close'} */
let tradeMode = 'buy';
/** @type {{ id: string, symbol: string, name: string } | null} */
let tradeTarget = null;
/** @type {string | null} */
let closingTradeId = null;
/** @type {string | null} */
let editingExchangeTradeId = null;
/** @type {string | null} */
let dragCoinId = null;
/** @type {'before' | 'after' | null} */
let dragInsert = null;

function applyState(state) {
  if (!state) return;
  coins = Array.isArray(state.coins) ? state.coins : [];
  trades = Array.isArray(state.trades) ? state.trades : [];
  dbPath = state.dbPath || dbPath;
  if (typeof state.alwaysOnTop === 'boolean') {
    alwaysOnTopEl.checked = state.alwaysOnTop;
  }
  if (state.lastExchange != null) {
    lastExchange = defaultExchange(state.lastExchange);
  }
}

function fillExchangeSelect(selectEl, selected) {
  if (!selectEl) return;
  const value = defaultExchange(selected);
  selectEl.innerHTML = '';
  for (const name of EXCHANGES) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === value) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

async function persistLastExchange(value) {
  const next = defaultExchange(value);
  lastExchange = next;
  if (window.cryptoWatcher?.db?.setLastExchange) {
    await window.cryptoWatcher.db.setLastExchange(next);
  }
}

function readLegacyLocalStorage() {
  let legacyCoins = [];
  let legacyTrades = [];
  let peak = 0;
  let alwaysOnTop = false;
  try {
    const rawCoins = localStorage.getItem(LEGACY_COINS_KEY);
    if (rawCoins) {
      const parsed = JSON.parse(rawCoins);
      if (Array.isArray(parsed)) {
        legacyCoins = parsed
          .filter((c) => c && typeof c.id === 'string')
          .map((c) => ({
            id: c.id,
            symbol: String(c.symbol || c.id).toLowerCase(),
            name: String(c.name || c.id),
          }));
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const rawTrades = localStorage.getItem(LEGACY_TRADES_KEY);
    if (rawTrades) {
      const parsed = JSON.parse(rawTrades);
      if (Array.isArray(parsed)) {
        legacyTrades = parsed
          .filter((t) => t && t.coinId)
          .map((t) => ({
            id: String(t.id || crypto.randomUUID()),
            coinId: String(t.coinId),
            symbol: String(t.symbol || '').toLowerCase(),
            side: t.side === 'sell' ? 'sell' : 'buy',
            qty: Number(t.qty),
            price: Number(t.price),
            time: Number(t.time) || Date.now(),
            sellPrice: t.sellPrice == null ? null : Number(t.sellPrice),
            sellTime: t.sellTime == null ? null : Number(t.sellTime),
          }));
      }
    }
  } catch {
    /* ignore */
  }
  peak = Number(localStorage.getItem(LEGACY_PEAK_KEY)) || 0;
  alwaysOnTop = localStorage.getItem(LEGACY_AOT_KEY) === '1';
  return { coins: legacyCoins, trades: legacyTrades, peakEquity: peak, alwaysOnTop };
}

function clearLegacyLocalStorage() {
  localStorage.removeItem(LEGACY_COINS_KEY);
  localStorage.removeItem(LEGACY_TRADES_KEY);
  localStorage.removeItem(LEGACY_PEAK_KEY);
  localStorage.removeItem(LEGACY_AOT_KEY);
}

async function saveCoins() {
  const state = await window.cryptoWatcher.db.saveCoins(coins);
  applyState(state);
}

async function saveTrades() {
  const state = await window.cryptoWatcher.db.saveTrades(trades);
  applyState(state);
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const opts =
    abs >= 1000
      ? { maximumFractionDigits: 2 }
      : abs >= 1
        ? { maximumFractionDigits: 4 }
        : { maximumSignificantDigits: 4 };
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    ...opts,
  }).format(value);
}

function formatMoney(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return sign + formatPrice(value);
}

function formatQty(value) {
  if (value == null || Number.isNaN(value)) return '—';
  if (value === 0) return '0';
  if (value >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
  return value.toLocaleString('en-US', { maximumSignificantDigits: 6 });
}

function formatChange(pct) {
  if (pct == null || Number.isNaN(pct)) return { text: '—', cls: 'flat' };
  const sign = pct > 0 ? '+' : '';
  return {
    text: `${sign}${pct.toFixed(2)}%`,
    cls: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
  };
}

function pnlClass(value) {
  if (value == null || Number.isNaN(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

function setStatus(text, isError = false) {
  statusTextEl.textContent = text;
  statusTextEl.classList.toggle('error', isError);
}

function updateStatusLine() {
  if (fetching) {
    setStatus('Updating…');
    return;
  }
  if (!lastUpdatedAt) {
    setStatus(coins.length ? 'Waiting for prices…' : 'No coins selected');
    return;
  }
  const sec = Math.max(0, Math.round((Date.now() - lastUpdatedAt) / 1000));
  const dbHint = dbPath ? ' · SQLite' : '';
  setStatus(`Updated ${sec}s ago${dbHint}`);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function refreshPortfolio() {
  const marks = new Map();
  for (const [id, row] of marketById) {
    if (row?.current_price != null) marks.set(id, Number(row.current_price));
  }

  const { positions, error } = rebuildPositions(trades);
  if (error) {
    console.warn(error);
  }

  positionsById = applyMarks(positions, marks);

  const useFilter =
    (currentPage === 'portfolio' || currentPage === 'staked') &&
    (portfolioFilterCoinId || portfolioFilterExchange);
  const scopedTrades = useFilter ? scopeTrades(trades) : trades;
  const scoped = rebuildPositions(scopedTrades);
  if (scoped.error) console.warn(scoped.error);
  const summary = computeSummary(applyMarks(scoped.positions, marks));
  renderSummary(summary);
  updatePortfolioFilterBar();
  updateStakedFilterBar();
}

function refreshViews() {
  renderList();
  renderPortfolio();
  renderStaked();
}

function scopeTrades(list) {
  let out = list;
  if (portfolioFilterCoinId) {
    out = out.filter((t) => t.coinId === portfolioFilterCoinId);
  }
  if (portfolioFilterExchange) {
    out = out.filter((t) => normalizeExchange(t.exchange) === portfolioFilterExchange);
  }
  return out;
}

function hasListFilter() {
  return Boolean(portfolioFilterCoinId || portfolioFilterExchange);
}

function filterBarParts() {
  const parts = [];
  if (portfolioFilterCoinId) {
    const coin = coins.find((c) => c.id === portfolioFilterCoinId);
    const label = (coin?.symbol || portfolioFilterCoinId).toUpperCase();
    const name = coin?.name || portfolioFilterCoinId;
    parts.push(`${label} · ${name}`);
  }
  if (portfolioFilterExchange) {
    parts.push(portfolioFilterExchange);
  }
  return parts;
}

function updateFilterBar(bar, labelEl, clearBtn, page) {
  if (!bar) return;
  if (currentPage !== page || !hasListFilter()) {
    bar.classList.add('hidden');
    return;
  }
  labelEl.textContent = filterBarParts().join(' · ');
  if (clearBtn) {
    clearBtn.textContent =
      portfolioFilterCoinId && portfolioFilterExchange
        ? 'Clear filters'
        : portfolioFilterExchange
          ? 'All exchanges'
          : 'All coins';
  }
  bar.classList.remove('hidden');
}

function updatePortfolioFilterBar() {
  updateFilterBar(portfolioFilterBar, portfolioFilterLabel, portfolioFilterClear, 'portfolio');
}

function updateStakedFilterBar() {
  updateFilterBar(stakedFilterBar, stakedFilterLabel, stakedFilterClear, 'staked');
}

function openCoinPortfolio(coinId) {
  portfolioFilterCoinId = coinId;
  portfolioFilterExchange = null;
  showPage('portfolio', { keepFilter: true });
}

function filterByExchange(exchange) {
  const ex = normalizeExchange(exchange);
  if (!ex) return;
  portfolioFilterExchange = ex;
  if (currentPage === 'portfolio') renderPortfolio();
  else if (currentPage === 'staked') renderStaked();
  else refreshPortfolio();
}

function clearPortfolioFilter() {
  portfolioFilterCoinId = null;
  portfolioFilterExchange = null;
  if (currentPage === 'portfolio') {
    renderPortfolio();
  } else if (currentPage === 'staked') {
    renderStaked();
  } else {
    refreshPortfolio();
  }
}

function showPage(page, { keepFilter = false } = {}) {
  if (page === 'portfolio' || page === 'staked') {
    currentPage = page;
  } else {
    currentPage = 'prices';
  }
  if ((currentPage === 'portfolio' || currentPage === 'staked') && !keepFilter) {
    portfolioFilterCoinId = null;
    portfolioFilterExchange = null;
  }
  pagePricesEl.classList.toggle('hidden', currentPage !== 'prices');
  pagePortfolioEl.classList.toggle('hidden', currentPage !== 'portfolio');
  pageStakedEl.classList.toggle('hidden', currentPage !== 'staked');
  for (const btn of document.querySelectorAll('.tab')) {
    const active = btn.dataset.page === currentPage;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  if (currentPage === 'portfolio') renderPortfolio();
  else if (currentPage === 'staked') renderStaked();
  else refreshPortfolio();
}

function createExchangeChip(lot) {
  const ex = normalizeExchange(lot?.exchange);
  if (!ex) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'exchange-chip';
  btn.textContent = ex;
  btn.title = `Show only ${ex}`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    filterByExchange(ex);
  });
  return btn;
}

function createTradeTitle(prefix, symbol, lot) {
  const row = document.createElement('div');
  row.className = 'coin-symbol trade-title-row';
  const text = document.createElement('span');
  text.textContent = `${prefix} ${symbol}`;
  row.appendChild(text);
  const chip = createExchangeChip(lot);
  if (chip) row.appendChild(chip);
  return row;
}

function emptyFilterMessage(kind) {
  if (portfolioFilterCoinId && portfolioFilterExchange) {
    return `No ${kind} for this coin on ${portfolioFilterExchange}.`;
  }
  if (portfolioFilterExchange) {
    return `No ${kind} on ${portfolioFilterExchange}.`;
  }
  if (portfolioFilterCoinId) {
    return `No ${kind} for this coin.`;
  }
  return null;
}

function renderPortfolio() {
  refreshPortfolio();
  activeListEl.innerHTML = '';
  historyListEl.innerHTML = '';

  const scoped = scopeTrades(trades);

  const openLots = scoped.filter(isActiveOpen).sort((a, b) => b.time - a.time);
  const closedLots = scoped
    .filter((t) => !isOpen(t))
    .sort((a, b) => (b.sellTime || b.time) - (a.sellTime || a.time));

  activeEmptyEl.classList.toggle('hidden', openLots.length > 0);
  historyEmptyEl.classList.toggle('hidden', closedLots.length > 0);
  activeEmptyEl.textContent =
    emptyFilterMessage('open buys') || 'No open buys. Add a Buy from the Prices tab.';
  historyEmptyEl.textContent =
    emptyFilterMessage('closed trades') || 'No closed trades yet.';

  for (const lot of openLots) {
    const coin = coins.find((c) => c.id === lot.coinId);
    const mark = marketById.get(lot.coinId)?.current_price ?? null;
    const uPnL = lotUnrealizedPnl(lot, mark);
    const li = document.createElement('li');
    li.className = 'active-card';

    const head = document.createElement('div');
    head.className = 'active-head';

    const headLeft = document.createElement('div');
    headLeft.appendChild(
      createTradeTitle('BUY', (coin?.symbol || lot.symbol || '').toUpperCase(), lot),
    );
    const nameLine = document.createElement('div');
    nameLine.className = 'coin-name';
    nameLine.textContent = `${coin?.name || lot.coinId} · ${new Date(lot.time).toLocaleString()}`;
    headLeft.appendChild(nameLine);

    const markEl = document.createElement('div');
    markEl.className = 'active-mark';
    markEl.textContent = formatPrice(mark);
    head.append(headLeft, markEl);

    const stats = document.createElement('div');
    stats.className = 'active-stats';
    stats.innerHTML = `
      <span>${formatQty(lot.qty)} @ ${formatPrice(lot.price)}</span>
      <span class="pnl ${pnlClass(uPnL)}">uPnL ${formatMoney(uPnL)}</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'position-actions';

    const sellBtn = document.createElement('button');
    sellBtn.type = 'button';
    sellBtn.className = 'btn tiny primary';
    sellBtn.textContent = 'Sell';
    sellBtn.addEventListener('click', () => openCloseDialog(lot));

    const stakeBtn = document.createElement('button');
    stakeBtn.type = 'button';
    stakeBtn.className = 'btn tiny';
    stakeBtn.textContent = 'Stake';
    stakeBtn.addEventListener('click', async () => {
      const result = stakeLot(trades, lot.id);
      if (result.error) {
        setStatus(result.error, true);
        return;
      }
      trades = result.trades;
      await saveTrades();
      refreshViews();
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn tiny';
    editBtn.textContent = 'Edit';
    editBtn.title = 'Edit exchange';
    editBtn.addEventListener('click', () => openExchangeDialog(lot));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn tiny';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      const ok = await askConfirm(
        `Delete this buy trade (${formatQty(lot.qty)} @ ${formatPrice(lot.price)})?`,
        'Delete',
      );
      if (!ok) return;
      trades = trades.filter((x) => x.id !== lot.id);
      await saveTrades();
      refreshViews();
    });

    actions.append(sellBtn, stakeBtn, editBtn, delBtn);
    li.append(head, stats, actions);
    activeListEl.appendChild(li);
  }

  for (const lot of closedLots) {
    const li = document.createElement('li');
    li.className = 'trade-item';
    const coin = coins.find((c) => c.id === lot.coinId);
    const label = (coin?.symbol || lot.symbol || lot.coinId).toUpperCase();
    const realized = lotRealizedPnl(lot);
    const when = new Date(lot.sellTime || lot.time).toLocaleString();

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'trade-title-row';
    const titleText = document.createElement('span');
    titleText.textContent = `${label} · ${formatQty(lot.qty)}`;
    title.appendChild(titleText);
    const chip = createExchangeChip(lot);
    if (chip) title.appendChild(chip);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `buy ${formatPrice(lot.price)} → sell ${formatPrice(lot.sellPrice)} · ${when}`;
    left.append(title, meta);

    const pnl = document.createElement('div');
    pnl.className = `pnl ${pnlClass(realized)}`;
    pnl.textContent = formatMoney(realized);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'remove-btn';
    del.title = 'Delete trade';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      trades = trades.filter((x) => x.id !== lot.id);
      await saveTrades();
      refreshViews();
    });
    li.append(left, pnl, del);
    historyListEl.appendChild(li);
  }
}

function renderStaked() {
  refreshPortfolio();
  if (!stakedListEl) return;
  stakedListEl.innerHTML = '';

  const scoped = scopeTrades(trades);

  const stakedLots = scoped
    .filter((t) => isOpen(t) && isStaked(t))
    .sort((a, b) => b.time - a.time);

  stakedEmptyEl.classList.toggle('hidden', stakedLots.length > 0);
  stakedEmptyEl.textContent =
    emptyFilterMessage('staked trades') || 'No staked trades.';

  for (const lot of stakedLots) {
    const coin = coins.find((c) => c.id === lot.coinId);
    const mark = marketById.get(lot.coinId)?.current_price ?? null;
    const uPnL =
      mark == null ? null : (Number(mark) - Number(lot.price)) * Number(lot.qty);
    const li = document.createElement('li');
    li.className = 'active-card';

    const head = document.createElement('div');
    head.className = 'active-head';

    const headLeft = document.createElement('div');
    headLeft.appendChild(
      createTradeTitle('STAKED', (coin?.symbol || lot.symbol || '').toUpperCase(), lot),
    );
    const nameLine = document.createElement('div');
    nameLine.className = 'coin-name';
    nameLine.textContent = `${coin?.name || lot.coinId} · ${new Date(lot.time).toLocaleString()}`;
    headLeft.appendChild(nameLine);

    const markEl = document.createElement('div');
    markEl.className = 'active-mark';
    markEl.textContent = formatPrice(mark);
    head.append(headLeft, markEl);

    const stats = document.createElement('div');
    stats.className = 'active-stats';
    stats.innerHTML = `
      <span>${formatQty(lot.qty)} @ ${formatPrice(lot.price)}</span>
      <span class="pnl ${pnlClass(uPnL)}">uPnL ${formatMoney(uPnL)}</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'position-actions';

    const unstakeBtn = document.createElement('button');
    unstakeBtn.type = 'button';
    unstakeBtn.className = 'btn tiny primary';
    unstakeBtn.textContent = 'Unstake';
    unstakeBtn.addEventListener('click', async () => {
      const result = unstakeLot(trades, lot.id);
      if (result.error) {
        setStatus(result.error, true);
        return;
      }
      trades = result.trades;
      await saveTrades();
      refreshViews();
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn tiny';
    editBtn.textContent = 'Edit';
    editBtn.title = 'Edit exchange';
    editBtn.addEventListener('click', () => openExchangeDialog(lot));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn tiny';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      const ok = await askConfirm(
        `Delete this staked trade (${formatQty(lot.qty)} @ ${formatPrice(lot.price)})?`,
        'Delete',
      );
      if (!ok) return;
      trades = trades.filter((x) => x.id !== lot.id);
      await saveTrades();
      refreshViews();
    });

    actions.append(unstakeBtn, editBtn, delBtn);
    li.append(head, stats, actions);
    stakedListEl.appendChild(li);
  }
}

function renderSummary(summary) {
  sumEquityEl.textContent = formatPrice(summary.equity);
  sumUnrealEl.textContent = formatMoney(summary.unrealizedPnl);
  sumUnrealEl.className = `summary-value ${pnlClass(summary.unrealizedPnl)}`;
  sumRealEl.textContent = formatMoney(summary.realizedPnl);
  sumRealEl.className = `summary-value ${pnlClass(summary.realizedPnl)}`;
  sumTotalEl.textContent = formatMoney(summary.totalPnl);
  sumTotalEl.className = `summary-value ${pnlClass(summary.totalPnl)}`;
}

function renderList() {
  refreshPortfolio();
  coinListEl.innerHTML = '';
  emptyStateEl.classList.toggle('hidden', coins.length > 0);

  for (const coin of coins) {
    const market = marketById.get(coin.id);
    const change = formatChange(market?.price_change_percentage_24h);
    const pos = positionsById.get(coin.id);

    const card = document.createElement('li');
    card.className = 'coin-card';
    card.dataset.id = coin.id;

    const row = document.createElement('div');
    row.className = 'coin-row';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'drag-handle';
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-label', 'Drag to reorder');
    handle.textContent = '⠿';
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      dragCoinId = coin.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', coin.id);
    });
    handle.addEventListener('dragend', () => {
      dragCoinId = null;
      clearDropIndicators();
      card.classList.remove('dragging');
    });

    const img = document.createElement('img');
    img.alt = '';
    img.src = market?.image || '';
    img.referrerPolicy = 'no-referrer';
    if (!market?.image) {
      img.removeAttribute('src');
      img.style.background = 'var(--border)';
    }

    const meta = document.createElement('div');
    meta.className = 'coin-meta clickable';
    meta.title = 'Open coin portfolio';
    meta.innerHTML = `<div class="coin-symbol">${coin.symbol.toUpperCase()}</div><div class="coin-name">${escapeHtml(coin.name)}</div>`;
    meta.addEventListener('click', () => openCoinPortfolio(coin.id));

    const price = document.createElement('div');
    price.className = 'coin-price clickable';
    price.title = 'Open coin portfolio';
    price.textContent = formatPrice(market?.current_price);
    price.addEventListener('click', () => openCoinPortfolio(coin.id));

    const chg = document.createElement('div');
    chg.className = `coin-change ${change.cls} clickable`;
    chg.title = 'Open coin portfolio';
    chg.textContent = change.text;
    chg.addEventListener('click', () => openCoinPortfolio(coin.id));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-btn';
    remove.title = 'Remove from watchlist';
    remove.textContent = '×';
    remove.addEventListener('click', () => removeCoin(coin.id));

    row.append(handle, img, meta, price, chg, remove);

    const posRow = document.createElement('div');
    posRow.className = 'position-row';

    const stats = document.createElement('div');
    stats.className = 'position-stats';
    if (pos && (pos.qty > 0 || pos.boughtQty > 0)) {
      const uCls = pnlClass(pos.unrealizedPnl);
      const bits = [
        `qty ${formatQty(pos.qty)}`,
        pos.qty > 0 ? `avg ${formatPrice(pos.avgCost)}` : null,
        pos.qty > 0 ? `uPnL <span class="pnl ${uCls}">${formatMoney(pos.unrealizedPnl)}</span>` : null,
        `bought ${formatQty(pos.boughtQty)}`,
      ].filter(Boolean);
      stats.innerHTML = bits.join(' · ');
    } else {
      stats.textContent = 'No position — add a Buy';
    }

    const actions = document.createElement('div');
    actions.className = 'position-actions';

    const buyBtn = document.createElement('button');
    buyBtn.type = 'button';
    buyBtn.className = 'btn tiny primary';
    buyBtn.textContent = 'Buy';
    buyBtn.addEventListener('click', () => openBuyDialog(coin));

    const portBtn = document.createElement('button');
    portBtn.type = 'button';
    portBtn.className = 'btn tiny';
    portBtn.textContent = 'Portfolio';
    portBtn.addEventListener('click', () => openCoinPortfolio(coin.id));

    actions.append(buyBtn, portBtn);
    posRow.append(stats, actions);
    card.append(row, posRow);
    coinListEl.appendChild(card);
  }
}

function clearDropIndicators() {
  for (const el of coinListEl.querySelectorAll('.drag-over-before, .drag-over-after')) {
    el.classList.remove('drag-over-before', 'drag-over-after');
  }
  dragInsert = null;
}

function coinCardFromTarget(target) {
  if (!(target instanceof Element)) return null;
  return target.closest('.coin-card');
}

async function reorderCoin(fromId, toId, insert) {
  if (!fromId || !toId || fromId === toId) return;
  const moving = coins.find((c) => c.id === fromId);
  if (!moving) return;

  const next = coins.filter((c) => c.id !== fromId);
  const toIdx = next.findIndex((c) => c.id === toId);
  if (toIdx < 0) return;

  const insertAt = insert === 'after' ? toIdx + 1 : toIdx;
  next.splice(insertAt, 0, moving);

  const unchanged = next.every((c, i) => c.id === coins[i]?.id);
  if (unchanged) return;

  coins = next;
  await saveCoins();
  renderList();
}

async function removeCoin(id) {
  const hasTrades = trades.some((t) => t.coinId === id);
  if (hasTrades) {
    const ok = await askConfirm(
      'This coin has trades. Remove from watchlist anyway? (trades stay in history)',
      'Remove',
    );
    if (!ok) return;
  }
  coins = coins.filter((c) => c.id !== id);
  marketById.delete(id);
  await saveCoins();
  refreshViews();
  updateStatusLine();
  fetchPrices();
}

async function addCoin(coin) {
  if (coins.some((c) => c.id === coin.id)) return;
  coins.push({
    id: coin.id,
    symbol: String(coin.symbol || '').toLowerCase(),
    name: coin.name || coin.id,
  });
  await saveCoins();
  refreshViews();
  addDialog.close();
  fetchPrices();
}

function openBuyDialog(coin) {
  tradeMode = 'buy';
  tradeTarget = coin;
  closingTradeId = null;
  tradeTitle.textContent = `Buy ${coin.symbol.toUpperCase()}`;
  tradePriceLabel.textContent = 'Buy price (USD)';
  tradeSubmit.textContent = 'Buy';
  tradeSubmit.disabled = false;
  tradeSubmit.classList.remove('flash-ok');
  tradeQtyField.classList.remove('hidden');
  tradeExchangeField.classList.remove('hidden');
  tradeExchange.required = true;
  fillExchangeSelect(tradeExchange, lastExchange);
  tradeQty.value = '';
  tradeQty.readOnly = false;
  tradeQty.disabled = false;
  tradePrice.readOnly = false;
  tradePrice.disabled = false;
  const mark = marketById.get(coin.id)?.current_price;
  tradePrice.value = mark != null ? String(mark) : '';
  tradeHint.classList.add('hidden');
  tradePreview.classList.add('hidden');
  hideTradeError();
  hideTradeSuccess();
  tradeDialog.showModal();
  requestAnimationFrame(() => tradeQty.focus());
}

function openCloseDialog(lot) {
  const coin = coins.find((c) => c.id === lot.coinId) || {
    id: lot.coinId,
    symbol: lot.symbol,
    name: lot.coinId,
  };
  tradeMode = 'close';
  tradeTarget = coin;
  closingTradeId = lot.id;
  tradeTitle.textContent = `Sell ${coin.symbol.toUpperCase()}`;
  tradePriceLabel.textContent = 'Sell price (USD)';
  tradeSubmit.textContent = 'Close trade';
  tradeSubmit.disabled = false;
  tradeSubmit.classList.remove('flash-ok');
  tradeQtyField.classList.remove('hidden');
  tradeExchangeField.classList.add('hidden');
  tradeExchange.required = false;
  tradeQty.value = String(lot.qty);
  tradeQty.readOnly = true;
  const mark = marketById.get(lot.coinId)?.current_price;
  tradePrice.value = mark != null ? String(mark) : '';
  tradeHint.classList.remove('hidden');
  tradeHint.textContent = `Closing lot: ${formatQty(lot.qty)} bought @ ${formatPrice(lot.price)}`;
  hideTradeError();
  hideTradeSuccess();
  updateClosePreview(lot);
  tradeDialog.showModal();
  tradePrice.focus();
}

function updateClosePreview(lot) {
  const sellPrice = Number(tradePrice.value);
  if (!(sellPrice > 0) || !lot) {
    tradePreview.classList.add('hidden');
    return;
  }
  const est = (sellPrice - Number(lot.price)) * Number(lot.qty);
  tradePreview.classList.remove('hidden');
  tradePreview.innerHTML = `Est. realized: <span class="pnl ${pnlClass(est)}">${formatMoney(est)}</span>`;
}

function askConfirm(message, okLabel = 'OK') {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    confirmOk.textContent = okLabel;
    const onClose = () => {
      confirmDialog.removeEventListener('close', onClose);
      resolve(confirmDialog.returnValue === 'ok');
    };
    confirmDialog.addEventListener('close', onClose);
    confirmDialog.showModal();
    confirmOk.focus();
  });
}

function hideTradeError() {
  tradeError.classList.add('hidden');
  tradeError.textContent = '';
}

function showTradeError(msg) {
  hideTradeSuccess();
  tradeError.textContent = msg;
  tradeError.classList.remove('hidden');
}

function hideTradeSuccess() {
  tradeSuccess.classList.add('hidden');
  tradeSuccess.textContent = '';
}

function showTradeSuccess(msg) {
  hideTradeError();
  tradeSuccess.textContent = msg;
  tradeSuccess.classList.remove('hidden');
}

function hideExchangeError() {
  exchangeError.classList.add('hidden');
  exchangeError.textContent = '';
}

function showExchangeError(msg) {
  exchangeError.textContent = msg;
  exchangeError.classList.remove('hidden');
}

function openExchangeDialog(lot) {
  editingExchangeTradeId = lot.id;
  fillExchangeSelect(exchangeSelect, lot.exchange || lastExchange);
  hideExchangeError();
  exchangeDialog.showModal();
  requestAnimationFrame(() => exchangeSelect.focus());
}

exchangeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editingExchangeTradeId) return;
  const exchange = normalizeExchange(exchangeSelect.value);
  if (!exchange) {
    showExchangeError('Choose OKX, Bitget, or Gate');
    return;
  }
  exchangeSubmit.disabled = true;
  try {
    const result = setTradeExchange(trades, editingExchangeTradeId, exchange);
    if (result.error) {
      showExchangeError(result.error);
      return;
    }
    trades = result.trades;
    await saveTrades();
    await persistLastExchange(exchange);
    editingExchangeTradeId = null;
    exchangeDialog.close();
    refreshViews();
  } finally {
    exchangeSubmit.disabled = false;
  }
});

exchangeCancel.addEventListener('click', () => {
  editingExchangeTradeId = null;
  exchangeDialog.close();
});

tradeForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (tradeMode === 'close') {
    const lot = trades.find((t) => t.id === closingTradeId);
    const sellPrice = Number(tradePrice.value);
    const check = validateClose(lot, sellPrice);
    if (!check.ok) {
      showTradeError(check.message);
      return;
    }
    tradeSubmit.disabled = true;
    try {
      const result = closeLot(trades, closingTradeId, sellPrice);
      if (result.error) {
        showTradeError(result.error);
        return;
      }
      trades = result.trades;
      await saveTrades();
      hideTradeError();
      tradeDialog.close();
      tradeTarget = null;
      closingTradeId = null;
      refreshViews();
    } finally {
      tradeSubmit.disabled = false;
    }
    return;
  }

  if (!tradeTarget) return;
  const qty = Number(tradeQty.value);
  const price = Number(tradePrice.value);
  const exchange = normalizeExchange(tradeExchange.value);
  const check = validateBuy({ qty, price });
  if (!check.ok) {
    showTradeError(check.message);
    return;
  }
  if (!exchange) {
    showTradeError('Choose OKX, Bitget, or Gate');
    return;
  }

  tradeSubmit.disabled = true;
  tradeSubmit.textContent = 'Saving…';
  try {
    trades.push({
      id: crypto.randomUUID(),
      coinId: tradeTarget.id,
      symbol: tradeTarget.symbol,
      qty,
      price,
      time: Date.now(),
      sellPrice: null,
      sellTime: null,
      staked: false,
      exchange,
    });
    await saveTrades();
    await persistLastExchange(exchange);
    showTradeSuccess(
      `Bought ${formatQty(qty)} ${tradeTarget.symbol.toUpperCase()} @ ${formatPrice(price)}`,
    );
    tradeSubmit.textContent = 'Bought ✓';
    tradeSubmit.classList.add('flash-ok');
    tradeQty.readOnly = false;
    tradePrice.readOnly = false;
    tradeQty.disabled = false;
    tradePrice.disabled = false;
    tradeQty.value = '';
    refreshViews();
    setStatus(
      `Bought ${formatQty(qty)} ${tradeTarget.symbol.toUpperCase()} — see Portfolio`,
    );
    // Re-enable immediately so typing works right away
    tradeSubmit.disabled = false;
    requestAnimationFrame(() => {
      tradeQty.focus();
      tradeQty.select?.();
    });
    setTimeout(() => {
      if (tradeMode === 'buy' && tradeDialog.open) {
        tradeSubmit.textContent = 'Buy';
        tradeSubmit.classList.remove('flash-ok');
      }
    }, 900);
  } catch (err) {
    console.error(err);
    showTradeError(err?.message || 'Failed to save buy');
    tradeSubmit.textContent = 'Buy';
    tradeSubmit.classList.remove('flash-ok');
    tradeSubmit.disabled = false;
    tradeQty.readOnly = false;
    tradePrice.readOnly = false;
  }
});

tradeCancel.addEventListener('click', () => {
  tradeDialog.close();
  tradeTarget = null;
  closingTradeId = null;
});

tradePrice.addEventListener('input', () => {
  if (tradeMode === 'close' && closingTradeId) {
    const lot = trades.find((t) => t.id === closingTradeId);
    updateClosePreview(lot);
  }
});

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

portfolioFilterClear?.addEventListener('click', () => clearPortfolioFilter());
stakedFilterClear?.addEventListener('click', () => clearPortfolioFilter());

coinListEl.addEventListener('dragover', (e) => {
  if (!dragCoinId) return;
  const card = coinCardFromTarget(e.target);
  if (!card || card.dataset.id === dragCoinId) {
    clearDropIndicators();
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = card.getBoundingClientRect();
  const insert = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  if (dragInsert === insert && card.classList.contains(`drag-over-${insert}`)) return;
  clearDropIndicators();
  dragInsert = insert;
  card.classList.add(insert === 'before' ? 'drag-over-before' : 'drag-over-after');
});

coinListEl.addEventListener('dragleave', (e) => {
  if (!coinListEl.contains(e.relatedTarget)) {
    clearDropIndicators();
  }
});

coinListEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  const card = coinCardFromTarget(e.target);
  const fromId = dragCoinId || e.dataTransfer.getData('text/plain');
  const insert = dragInsert;
  clearDropIndicators();
  if (!card || !fromId || !insert) return;
  await reorderCoin(fromId, card.dataset.id, insert);
});

async function fetchPrices() {
  if (!coins.length) {
    marketById = new Map();
    refreshViews();
    updateStatusLine();
    return;
  }

  fetching = true;
  updateStatusLine();

  try {
    const ids = coins.map((c) => c.id).join(',');
    const url =
      `https://api.coingecko.com/api/v3/coins/markets` +
      `?vs_currency=usd&ids=${encodeURIComponent(ids)}` +
      `&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`CoinGecko HTTP ${res.status}`);
    }
    const data = await res.json();
    const next = new Map();
    for (const row of data) {
      next.set(row.id, row);
    }
    marketById = next;
    lastUpdatedAt = Date.now();
    refreshViews();
    setStatus('Updated just now');
  } catch (err) {
    console.error(err);
    setStatus(err?.message || 'Failed to fetch prices', true);
    refreshViews();
  } finally {
    fetching = false;
  }
}

async function searchCoins(query) {
  const q = query.trim();
  if (q.length < 1) {
    searchResultsEl.innerHTML = '';
    return;
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
    const data = await res.json();
    const items = (data.coins || []).slice(0, 12);
    searchResultsEl.innerHTML = '';

    if (!items.length) {
      searchResultsEl.innerHTML = `<li style="cursor:default;color:var(--muted)">No results</li>`;
      return;
    }

    for (const item of items) {
      const already = coins.some((c) => c.id === item.id);
      const li = document.createElement('li');
      li.innerHTML = `
        <img src="${item.thumb || ''}" alt="" referrerpolicy="no-referrer" />
        <div>
          <div class="sym">${escapeHtml(item.symbol?.toUpperCase() || '')}</div>
          <div class="name">${escapeHtml(item.name || '')}</div>
        </div>
        <div class="add-label">${already ? 'Added' : 'Add'}</div>
      `;
      if (!already) {
        li.addEventListener('click', () =>
          addCoin({ id: item.id, symbol: item.symbol, name: item.name }),
        );
      } else {
        li.style.opacity = '0.5';
        li.style.cursor = 'default';
      }
      searchResultsEl.appendChild(li);
    }
  } catch (err) {
    searchResultsEl.innerHTML = `<li style="cursor:default" class="error">${escapeHtml(err?.message || 'Search failed')}</li>`;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    fetchPrices();
  }, POLL_MS);
  setInterval(updateStatusLine, 1000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function initAlwaysOnTop() {
  if (window.cryptoWatcher?.setAlwaysOnTop) {
    await window.cryptoWatcher.setAlwaysOnTop(alwaysOnTopEl.checked);
  }
}

alwaysOnTopEl.addEventListener('change', async () => {
  const enabled = alwaysOnTopEl.checked;
  if (window.cryptoWatcher?.setAlwaysOnTop) {
    await window.cryptoWatcher.setAlwaysOnTop(enabled);
  }
});

addCoinBtn.addEventListener('click', () => {
  coinSearchEl.value = '';
  searchResultsEl.innerHTML = '';
  addDialog.showModal();
  coinSearchEl.focus();
});

coinSearchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchCoins(coinSearchEl.value), 250);
});

refreshBtn.addEventListener('click', () => fetchPrices());

addDialog.addEventListener('close', () => {
  searchResultsEl.innerHTML = '';
});

async function boot() {
  if (!window.cryptoWatcher?.db) {
    setStatus('SQLite bridge unavailable — run via Electron (npm start)', true);
    return;
  }

  const legacy = readLegacyLocalStorage();
  const hasLegacy = legacy.coins.length > 0 || legacy.trades.length > 0 || legacy.peakEquity > 0;

  let state;
  if (hasLegacy) {
    state = await window.cryptoWatcher.db.migrateLocal(legacy);
    clearLegacyLocalStorage();
  } else {
    state = await window.cryptoWatcher.db.ensureDefaults();
  }

  applyState(state);
  dbPath = state.dbPath || (await window.cryptoWatcher.db.getPath());

  showPage('prices');
  refreshViews();
  await initAlwaysOnTop();
  fetchPrices();
  startPolling();
}

boot().catch((err) => {
  console.error(err);
  setStatus(err?.message || 'Failed to open SQLite', true);
});
