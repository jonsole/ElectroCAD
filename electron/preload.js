// ElectroCAD - preload bridge. Exposes a small, explicit API to the renderer
// (same pattern as DabbleCAD's preload).
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('electroNative', {
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  listProjects: call('store:list'),
  loadProject: call('store:load'),
  storeProject: call('store:save'),
  deleteProject: call('store:delete'),
  openProjectsFolder: call('store:folder'),
  listLibraries: call('lib:list'),
  saveLibrary: call('lib:save'),
  deleteLibrary: call('lib:delete'),
  importFile: call('file:import'),
  importFiles: call('file:importMany'),
  exportFile: call('file:export'),
  onBeforeClose: (fn) => ipcRenderer.on('app:before-close', () => fn()),
  closeReady: () => ipcRenderer.send('app:close-ready'),
  smokeShot: call('smoke:shot'),
  smokeDialog: call('smoke:dialog'),
});
