@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0engine\Generate.ps1"
set "GENERATOR_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %GENERATOR_EXIT_CODE%
