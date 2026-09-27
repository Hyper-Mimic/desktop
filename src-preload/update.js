const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('UpdatePreload', {
  getStrings: () => ipcRenderer.sendSync('get-strings'),
  getInfo: () => ipcRenderer.sendSync('get-info'),
  getChangelog: () => ipcRenderer.invoke('get-changelog'),
  download: () => ipcRenderer.invoke('download'),
  ignore: (permanently) => ipcRenderer.invoke('ignore', permanently)
});
