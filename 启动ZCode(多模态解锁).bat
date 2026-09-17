@echo off
chcp 65001 >nul
title ZCode 免登录 ^& 多模态增强启动器 (CDP)

cd /d "%~dp0"

echo ==========================================
echo    ZCode 免登录 ^& 多模态增强启动器 (CDP)   
echo ==========================================
echo.

:: 检查 Node.js 是否已安装并在 PATH 中
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未能在系统中找到 Node.js 执行程序！
    echo 请安装 Node.js (>= 22.0.0) 并确保其已添加到系统 PATH 环境变量中。
    echo 官方下载地址: https://nodejs.org/
    echo.
    echo 按任意键退出...
    pause >nul
    exit /b 1
)

:: 在后台启动守护进程，日志输出到 launcher.log
echo [*] 正在启动并建立 CDP 内存热补丁会话...
start "" /b node "%~dp0zcode-cdp-launcher.mjs" --restart > "%~dp0launcher.log" 2>&1

:: 等待 2 秒让注入生效
timeout /t 2 /nobreak >nul

echo ✨ 注入完成！ZCode 窗口已在内存中完成热修补：
echo    1. 启动登录遮罩已切断
echo    2. 左下角头像与昵称已隐藏
echo    3. 多模态与 /plan 限制已放行
echo.
echo (本窗口将在 2 秒后自动退出，也可直接关闭)
timeout /t 2 /nobreak >nul
exit /b 0
