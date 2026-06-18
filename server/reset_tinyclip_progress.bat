@echo off
echo Are you sure you want to reset TinyCLIP progress?
echo This will start from the beginning next time you run the embedding script.
pause
cd /d "%~dp0"
if exist tinyclip_progress.json (
  del tinyclip_progress.json
  echo Progress file deleted!
) else (
  echo No progress file found to delete!
)
pause
