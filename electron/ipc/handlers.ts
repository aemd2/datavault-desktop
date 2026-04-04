import { ipcMain, app } from "electron";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:version", () => app.getVersion());
}
