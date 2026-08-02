const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cryptoWatcher', {
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('set-always-on-top', enabled),
  db: {
    getState: () => ipcRenderer.invoke('db:get-state'),
    getPath: () => ipcRenderer.invoke('db:get-path'),
    saveCoins: (coins) => ipcRenderer.invoke('db:save-coins', coins),
    saveTrades: (trades) => ipcRenderer.invoke('db:save-trades', trades),
    setPeak: (value) => ipcRenderer.invoke('db:set-peak', value),
    setLastExchange: (value) => ipcRenderer.invoke('db:set-last-exchange', value),
    migrateLocal: (payload) => ipcRenderer.invoke('db:migrate-local', payload),
    ensureDefaults: () => ipcRenderer.invoke('db:ensure-defaults'),
  },
});
