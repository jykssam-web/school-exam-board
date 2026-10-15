@echo off
chcp 65001 > nul
title [학교 실시간 시험상황실 & 전자칠판 알림 시스템]

echo ========================================================
echo   🏫 [학교 실시간 시험상황실 & 전자칠판 알림 시스템]
echo   연구부장 / 관리자용 서버를 구동합니다...
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [오류] Node.js 가 설치되어 있지 않습니다.
    echo Node.js(https://nodejs.org)를 설치하시거나,
    echo 포터블 패키지를 이용해 주세요.
    pause
    exit /b
)

:: 백그라운드 서버 실행 및 브라우저 자동 오픈
start /b node server.js

:: 2초 대기 후 브라우저 자동 실행
timeout /t 2 /nobreak > nul
start http://localhost:3019

echo.
echo ========================================================
echo   서버가 정상적으로 켜졌습니다!
echo   브라우저가 자동으로 열렸습니다.
echo   이 검은 창을 닫으시면 서버가 종료되니,
echo   시험이 끝날 때까지 창을 최소화(-)해 두세요.
echo ========================================================
echo.
pause
