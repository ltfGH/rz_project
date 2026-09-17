import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

import { buildWindowOptions } from './window-options';

export function createMainWindow(rendererPath: string, preloadPath: string): BrowserWindow {
  const window = new BrowserWindow(buildWindowOptions(preloadPath));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.once('ready-to-show', () => window.show());
  void window.loadFile(path.resolve(rendererPath));
  return window;
}
