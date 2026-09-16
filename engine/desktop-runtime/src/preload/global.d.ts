import type { BusinessApi } from './api';

declare global {
  interface Window {
    readonly businessApi: BusinessApi;
  }
}

export {};
