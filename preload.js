// preload.js
const { contextBridge, ipcRenderer } = require('electron');

window.addToRequestList = async (requestText) => {
    const success = await ipcRenderer.invoke('add-to-request-list', requestText);
    console.log('addToRequestList called, success:', success);
    return success;
};

window.updateRequestList = async (originalText, updatedText) => {
    const success = await ipcRenderer.invoke('update-request-list', originalText, updatedText);
    console.log('updateRequestList called, success:', success);
    return success;
};

contextBridge.exposeInMainWorld('electronAPI', {
    sendPlayerList: (list) => ipcRenderer.send('player-list-update', list)
});
