'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => ipcRenderer.on(channel, (_event, payload) => callback(payload));

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  getStats: () => ipcRenderer.invoke('settings:get-stats'),
  set: (key, value) => ipcRenderer.send('settings:set', key, value),
  reset: () => ipcRenderer.send('settings:reset'),
  action: (name, petId) => ipcRenderer.send('settings:action', name, petId),
  updatePet: (petId, patch) => ipcRenderer.send('settings:pet-update', petId, patch),
  buy: (id) => ipcRenderer.invoke('settings:buy', id),
  place: (id) => ipcRenderer.send('settings:place', id),
  putAway: (id) => ipcRenderer.send('settings:put-away', id),
  saveReminder: (reminder) => ipcRenderer.invoke('settings:reminder-save', reminder),
  deleteReminder: (id) => ipcRenderer.send('settings:reminder-delete', id),
  toggleReminder: (id, enabled) => ipcRenderer.send('settings:reminder-toggle', id, enabled),
  onValues: listen('settings:values'),
  onRoster: listen('settings:roster'),
  onStats: listen('settings:stats'),
  onHome: listen('settings:home'),
  onReminders: listen('settings:reminders'),
  onShowTab: listen('settings:show-tab'),
});
