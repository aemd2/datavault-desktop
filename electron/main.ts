import { app, BrowserWindow, shell, session, ipcMain } from "electron";
import path from "path";
import { registerIpcHandlers } from "./ipc/handlers";
import { buildCSP } from "./utils/security";

const isDev = process.env.NODE_ENV === "development";
const PROTOCOL = "datavault";

let mainWindow: BrowserWindow | null = null;

// ── Custom protocol: datavault:// ───────────────────────────────────────────
// Used for:
//   - Auth magic-link callbacks: datavault://auth/callback#access_token=...
//   - Post-OAuth return: datavault://dashboard (focuses the app)
//
// On Windows the URL arrives via second-instance argv.
// On macOS it arrives via the open-url event.

// Windows: ensure only one instance handles the protocol
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // The deep-link URL is the last argument on Windows
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) handleDeepLink(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Register as default handler for datavault:// (needs to run before app.whenReady)
if (process.defaultApp) {
  // Dev: launched via `electron .` so argv[1] is the entry point
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function handleDeepLink(url: string): void {
  console.log("[deep-link]", url);
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  // Forward raw URL to renderer so it can extract tokens / navigate
  mainWindow.webContents.send("deep-link", url);
}

// ── Window ──────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "DataVault",
    webPreferences: {
      // Security: renderer has no Node.js access — only contextBridge API
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Block external navigation inside the app window.
  // External URLs (OAuth, docs, Supabase dashboard) open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const appUrl = isDev ? "http://localhost:8080" : "file://";
    if (!url.startsWith(appUrl) && !url.startsWith(`${PROTOCOL}://`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Renderer asks main to open a URL in the system browser (e.g. Notion OAuth)
  ipcMain.handle("app:open-external", (_event, url: string) => {
    shell.openExternal(url);
  });

  // Apply Content Security Policy to all responses
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [buildCSP()],
      },
    });
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:8080");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  // macOS: handle datavault:// deep links
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on("activate", () => {
    // macOS: re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Windows/Linux: quit when all windows are closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Prevent new renderer processes from being created (navigation security)
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => {
    // Disallow all <webview> tags
    event.preventDefault();
  });
});
