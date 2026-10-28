'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => ipcRenderer.on(channel, (_event, payload) => callback(payload));

contextBridge.exposeInMainWorld('petAPI', {
  getConfig: () => ipcRenderer.invoke('pet:get-config'),
  getDisplay: () => ipcRenderer.invoke('pet:get-display'),
  transferPet: (petId, move) => ipcRenderer.invoke('pet:transfer', petId, move),
  getRoster: () => ipcRenderer.invoke('pet:get-roster'),
  getPlatforms: () => ipcRenderer.invoke('pet:get-platforms'),
  getHome: () => ipcRenderer.invoke('pet:get-home'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore-mouse', ignore),
  reportStatus: (status) => ipcRenderer.send('pet:status', status),
  showContextMenu: (petId, reminderId) => ipcRenderer.send('pet:context-menu', petId, reminderId),
  showFurnitureMenu: (id) => ipcRenderer.send('pet:furniture-menu', id),
  placeFurniture: (id, x) => ipcRenderer.send('pet:place-furniture', id, x),
  reminderAction: (id, action) => ipcRenderer.send('pet:reminder-action', id, action),
  sendEvent: (type, petId) => ipcRenderer.send('pet:event', type, petId),
  onTypingRate: listen('pet:typing-rate'),
  onKeyActivity: listen('pet:key-activity'),
  onCommand: listen('pet:command'),
  onSay: listen('pet:say'),
  onConfig: listen('pet:config'),
  onAmbient: listen('pet:ambient'),
  onRoster: listen('pet:roster'),
  onHome: listen('pet:home'),
  onPlatforms: listen('pet:platforms'),
  onDisplay: listen('pet:display'),
  onArrive: listen('pet:arrive'),
  onCursor: listen('pet:cursor'),
  onSummon: listen('pet:summon'),
  onSystem: listen('pet:system'),
  onReminder: listen('pet:reminder'),
  onLevelUp: listen('pet:level-up'),
  onToast: listen('pet:toast'),
});
