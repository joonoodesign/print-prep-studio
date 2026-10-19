@echo off
chcp 65001 > nul
title PrintPrep Studio Pro - 인디자인 직통 브릿지 & 사내 공유 서버 (Port 8090)

cd /d "%~dp0"

echo ====================================================================
echo   PrintPrep Studio Pro - 로컬 부스터 및 사내 공유 서버 시작 중...
echo ====================================================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [경고] Python이 설치되어 있지 않거나 PATH에 등록되지 않았습니다.
    echo 파이썬 없이도 브라우저에서 100%% 작동하므로 index.html을 직접 엽니다.
    start "" "%~dp0index.html"
    pause
    exit /b 0
)

echo [1/2] 기본 브라우저에서 PrintPrep Studio Pro (http://localhost:8090) 열기...
start "" "http://localhost:8090"

echo [2/2] 포트 8090에서 파이썬 인디자인 브릿지 서버를 가동합니다...
echo.
python "%~dp0server.py"

pause
