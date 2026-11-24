// ElectroCAD - preload bridge. Exposes a small, explicit API to the renderer
// (same pattern as DabbleCAD's preload).
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('electroNative', {
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  openProject: call('project:open'),
  saveProject: call('project:save'),
  smokeShot: call('smoke:shot'),
  smokeDialog: call('smoke:dialog'),
});
