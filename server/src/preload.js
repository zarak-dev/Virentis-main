/**
 * VIRentis — Secure Electron Preload Bridge
 *
 * Exposes a minimal, secure bridge to the renderer process.
 * Maintains contextIsolation: true and nodeIntegration: false.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('virentisDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
});
