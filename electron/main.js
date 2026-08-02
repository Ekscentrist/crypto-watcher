import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeDatabase,
  ensureCoins,
  getDbPath,
  getState,
  migrateFromLocalStorage,
  openDatabase,
  saveCoins,
  saveTrades,
  setAlwaysOnTopPref,
  setLastExchange,
  setPeakEquity,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// Keep userData path stable across electron-builder productName ("Crypto Watcher").
app.setName('crypto-watcher');

const DEFAULT_COINS = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum' },
  { id: 'solana', symbol: 'sol', name: 'Solana' },
];

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 400,
    minHeight: 460,
    backgroundColor: '#0f1419',
    title: 'Crypto Watcher',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('set-always-on-top', (_event, enabled) => {
  setAlwaysOnTopPref(Boolean(enabled));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(Boolean(enabled));
  }
  return Boolean(enabled);
});

ipcMain.handle('db:get-state', () => getState());
ipcMain.handle('db:get-path', () => getDbPath());
ipcMain.handle('db:save-coins', (_e, coins) => saveCoins(coins));
ipcMain.handle('db:save-trades', (_e, trades) => saveTrades(trades));
ipcMain.handle('db:set-peak', (_e, value) => setPeakEquity(value));
ipcMain.handle('db:set-last-exchange', (_e, value) => setLastExchange(value));
ipcMain.handle('db:migrate-local', (_e, payload) => {
  const result = migrateFromLocalStorage(payload);
  return ensureCoins(DEFAULT_COINS);
});
ipcMain.handle('db:ensure-defaults', () => ensureCoins(DEFAULT_COINS));

app.whenReady().then(async () => {
  await openDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
