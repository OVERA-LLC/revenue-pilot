const { autoUpdater } = require("electron-updater");
const { app, BrowserWindow, dialog } = require("electron");
const http = require("http");
const path = require("path");

app.disableHardwareAcceleration();

let server;

process.on("uncaughtException", (err) => {
  dialog.showErrorBox("Revenue Pilot Error", err.stack || err.message);
});

function waitForServer(url) {
  return new Promise((resolve) => {
    const check = () => {
      http.get(url + "/api/health", (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(check, 300);
        }
      }).on("error", () => {
        setTimeout(check, 300);
      });
    };
    check();
  });
}

async function createWindow() {
  server = require("./server")();

  await waitForServer("http://127.0.0.1:3000");

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.ico")
  });
  // 開発中だけDevToolsを開く
  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }
  await win.loadURL("http://127.0.0.1:3000");
}

app.whenReady().then(async () => {  try {
    autoUpdater.checkForUpdatesAndNotify();
    await createWindow();
  } catch (err) {
    dialog.showErrorBox(
      "起動エラー",
      err.stack || err.message
    );
  }
});

app.on("window-all-closed", () => {
  if (server) {
    server.close();
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});