@echo off
echo Are you sure you want to reset TinyCLIP (Python) progress?
echo This will start from the beginning next time you run the embedding script.
pause
cd /d "%~dp0"
if exist tinyclip_embedding_progress.json (
  del tinyclip_embedding_progress.json
  echo Progress file deleted!
) else (
  echo No progress file found to delete!
)
pause
