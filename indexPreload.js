const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onUpdatePlayerList: (callback) => ipcRenderer.on('update-player-list', (event, list) => callback(list))
});