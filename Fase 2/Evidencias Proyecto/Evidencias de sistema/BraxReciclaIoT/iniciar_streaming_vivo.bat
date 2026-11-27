@echo off
title BraxRecicla - Streaming Video Tolva en Vivo (Puerto 5000)
cd /d "%~dp0"
echo ========================================================
echo Iniciando Servidor de Streaming de Video en Vivo...
echo Puerto: 5000
echo Canal:  http://localhost:5000/video_feed
echo ========================================================
python servidor_video_live.py
pause
