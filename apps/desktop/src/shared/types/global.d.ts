import type { IpcApi } from "./index";

declare global {
  interface Window {
    clipme: IpcApi;
  }
}

export {};
