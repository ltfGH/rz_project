import type { BrowserWindowConstructorOptions } from 'electron';

export function buildWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1366,
    height: 820,
    minWidth: 1100,
    minHeight: 760,
    show: false,
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}
