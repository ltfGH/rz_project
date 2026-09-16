import { contextBridge, ipcRenderer } from 'electron';

import { createBusinessApi } from './api';

contextBridge.exposeInMainWorld(
  'businessApi',
  createBusinessApi((channel, request) => ipcRenderer.invoke(channel, request))
);
