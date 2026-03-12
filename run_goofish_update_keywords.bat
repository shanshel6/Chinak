@echo off
set GOOFISH_UPDATE_EXISTING=true
if "%1"=="" set GOOFISH_UPDATE_LIMIT=200
if "%2"=="" set GOOFISH_UPDATE_BATCH=10
if "%3"=="" set GOOFISH_UPDATE_DELAY_MIN=800
if "%4"=="" set GOOFISH_UPDATE_DELAY_MAX=1600
set GOOFISH_UPDATE_PROGRESS_EVERY=10
if not "%1"=="" set GOOFISH_UPDATE_LIMIT=%1
if not "%2"=="" set GOOFISH_UPDATE_BATCH=%2
if not "%3"=="" set GOOFISH_UPDATE_DELAY_MIN=%3
if not "%4"=="" set GOOFISH_UPDATE_DELAY_MAX=%4
node server/scripts/goofish-category-scraper.js
pause
