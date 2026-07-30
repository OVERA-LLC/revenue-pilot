@echo off
setlocal

echo ============================================
echo   Revenue Pilot release script
echo ============================================
echo.

set "VERSION="
set /p VERSION=New version number (example 1.2.0): 

echo.
echo You entered: [%VERSION%]
echo.

if not "%VERSION%"=="" goto :gotversion

echo No version entered. Stopping.
pause
goto :eof

:gotversion
echo [1/5] Updating package.json to %VERSION%
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf-8'));p.version=process.argv[1];fs.writeFileSync('package.json', JSON.stringify(p, null, 2)+String.fromCharCode(10));" %VERSION%
if not %errorlevel%==0 goto :failstep1

echo [2/5] Committing all changes
git add -A
git commit -m "release v%VERSION%"

echo [3/5] Pushing main branch to GitHub
git push origin main
if not %errorlevel%==0 goto :failstep3

echo [4/5] Creating tag v%VERSION%
git tag v%VERSION%

echo [5/5] Pushing tag to GitHub
git push origin v%VERSION%
if not %errorlevel%==0 goto :failstep5

echo.
echo ============================================
echo   Done. Build for v%VERSION% has started.
echo   Check progress at:
echo   https://github.com/OVERA-LLC/revenue-pilot/actions
echo ============================================
echo.
pause
goto :eof

:failstep1
echo Failed to update package.json. Stopping.
pause
goto :eof

:failstep3
echo Failed to push main branch. Stopping.
pause
goto :eof

:failstep5
echo Failed to push tag.
echo If a tag with this name already exists, run this then retry:
echo   git tag -d v%VERSION%
echo   git push origin --delete v%VERSION%
pause
goto :eof
