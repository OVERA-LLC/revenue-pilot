@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Revenue Pilot サーバー 起動中...
echo ============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [エラー] Node.js がこのパソコンに入っていないようです。
  echo.
  echo 今からNode.jsのダウンロードページを開きます。
  echo 「推奨版(LTS)」をダウンロードしてインストールしたあと、
  echo もう一度この start.bat をダブルクリックしてください。
  echo.
  start https://nodejs.org/ja
  pause
  exit /b
)

if not exist "node_modules" (
  echo 初回セットアップ中です。少し時間がかかります…(この画面は閉じないでください)
  call npm.cmd install
  if %errorlevel% neq 0 (
    echo.
    echo [エラー] セットアップに失敗しました。エラーメッセージを確認してください。
    pause
    exit /b
  )
  echo セットアップ完了。
  echo.
)

REM 初回起動時、このPCのデスクトップにまだショートカットが無ければ自動作成する
if not exist "%USERPROFILE%\Desktop\Revenue Pilot.lnk" (
  echo デスクトップにアイコン付きショートカットを作成しています…
  cscript //nologo "%~dp0create-shortcut.vbs" >nul
)

echo サーバーを起動します。このウィンドウは閉じずにそのままにしてください。
echo (このウィンドウを閉じると、他の人からも使えなくなります)
echo.

start "" http://localhost:3000

call npm.cmd start

pause
