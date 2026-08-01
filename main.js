const { autoUpdater } = require("electron-updater");
const { app, BrowserWindow, dialog } = require("electron");
const http = require("http");
const path = require("path");

app.disableHardwareAcceleration();

let server;

process.on("uncaughtException", (err) => {
  dialog.showErrorBox("Revenue Pilot Error", err.stack || err.message);
});

// アップデート確認の結果を必ず画面に表示する(今まで何も表示されず、成功も失敗も見分けが
// つかなかったため)。チェック開始・エラーはコンソールにも出す。
autoUpdater.on("checking-for-update", () => {
  console.log("[autoUpdater] チェック中...");
});
autoUpdater.on("update-available", (info) => {
  console.log("[autoUpdater] 新しいバージョンがあります:", info.version);
  dialog.showMessageBox({
    type: "info",
    title: "Revenue Pilot",
    message: `新しいバージョン(v${info.version})が見つかりました。バックグラウンドでダウンロードします。`
  });
});
autoUpdater.on("update-not-available", (info) => {
  console.log("[autoUpdater] 最新版です。現在のバージョン:", app.getVersion());
  dialog.showMessageBox({
    type: "info",
    title: "Revenue Pilot",
    message: `お使いのバージョン(v${app.getVersion()})はすでに最新です。`
  });
});
autoUpdater.on("error", (err) => {
  console.error("[autoUpdater] エラー:", err);
  dialog.showErrorBox("アップデート確認エラー", err == null ? "unknown" : (err.stack || err.message));
});
autoUpdater.on("update-downloaded", (info) => {
  console.log("[autoUpdater] ダウンロード完了:", info.version);
  dialog.showMessageBox({
    type: "info",
    title: "Revenue Pilot",
    message: `新しいバージョン(v${info.version})のダウンロードが完了しました。次回起動時に反映されます。`
  });
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
  // デフォルトの表示倍率を80%に(Ctrl+-を2回押した状態相当)
  win.webContents.setZoomFactor(0.8);
}

app.whenReady().then(async () => {
  try {
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
