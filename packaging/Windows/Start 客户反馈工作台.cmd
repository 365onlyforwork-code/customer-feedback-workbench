@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title 贝翰战略咨询 - 客户反馈工作台
set "CPU=%PROCESSOR_ARCHITECTURE%"
if defined PROCESSOR_ARCHITEW6432 set "CPU=%PROCESSOR_ARCHITEW6432%"
set "TARGET="
if /I "%CPU%"=="AMD64" set "TARGET=x64"
if /I "%CPU%"=="ARM64" set "TARGET=arm64"
if not defined TARGET goto unsupported
set "PY=%~dp0runtime\%TARGET%\python.exe"
if not exist "%PY%" goto incomplete
if not exist "%~dp0app\local_start.py" goto incomplete
"%PY%" -I -B -X utf8 -u "%~dp0app\local_start.py" %*
set "RESULT=%ERRORLEVEL%"
if "%RESULT%"=="0" exit /b 0
echo.
echo 启动程序已退出，错误代码 %RESULT%。请查看上方提示。
pause
exit /b %RESULT%

:unsupported
echo 此启动包支持 Windows x64 和 ARM64。当前处理器为 %CPU%。
pause
exit /b 1

:incomplete
echo 请先完整解压 Windows ZIP，再从解压后的文件夹双击启动文件。
pause
exit /b 1
