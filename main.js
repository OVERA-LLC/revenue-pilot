const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");

let serverProcess;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    autoHideMenuBar: true
  });

  // Expressサーバー起動
  serverProcess = spawn("node", ["server.js"], {
    shell: true,
    stdio: "inherit"
  });

  // サーバーが起動するまで少し待つ
  setTimeout(() => {
    win.loadURL("http://localhost:3000");
  }, 2000);
}

app.whenReady().then(createWindow);

// アプリ終了時にサーバーも終了
app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});