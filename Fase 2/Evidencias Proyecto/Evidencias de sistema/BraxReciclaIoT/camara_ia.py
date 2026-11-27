import cv2
import time
import random
from supabase import create_client, Client

# ==============================================================
# CONFIGURACIÓN DE SUPABASE
# ==============================================================
SUPABASE_URL = "https://raexkgrfehsgbbxybhlw.supabase.co"
SUPABASE_KEY = "sb_publishable_waBqMs26qUy79s2d1gsL3A_tVRnAv0Q"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ==============================================================
# CONFIGURACIÓN DE LA CÁMARA (SIMULADOR IOT)
# ==============================================================
PATENTE_CAMION = "BRX-12"
LATITUD_ACTUAL = -33.4569400
LONGITUD_ACTUAL = -70.6482700

def enviar_telemetria_a_supabase(porcentaje):
    """Envia el dato de llenado a la base de datos oficial"""
    try:
        data, count = supabase.table("telemetria_flota").insert({
            "patente_camion": PATENTE_CAMION,
            "porcentaje_llenado_ia": porcentaje,
            "latitud": LATITUD_ACTUAL,
            "longitud": LONGITUD_ACTUAL
        }).execute()
        print(f"✅ [ÉXITO] Telemetría enviada a la Nube: {porcentaje}% lleno")
    except Exception as e:
        print(f"❌ [ERROR] Falló la conexión a Supabase: {e}")

import numpy as np
import math

def iniciar_camara_ia():
    print("⚠️ Iniciando [MODO SIMULADOR HOLOGRÁFICO] puro para la Demo...")
    usar_camara_falsa = True

    print("==============================================================")
    print(f"📷 SISTEMA DE VISIÓN COMPUTACIONAL INICIADO (Camión {PATENTE_CAMION})")
    print("==============================================================")
    print("Presiona la tecla 'q' en la ventana de video para salir.\n")

    ultimo_envio = time.time()
    llenado_actual = 5.0
    angulo_radar = 0

    while True:
        if not usar_camara_falsa:
            ret, frame = cap.read()
            if not ret:
                usar_camara_falsa = True
                continue
            frame_procesado = cv2.applyColorMap(frame, cv2.COLORMAP_OCEAN)
        else:
            # Crear un frame negro (Simulador de Radar)
            frame_procesado = np.zeros((480, 640, 3), dtype=np.uint8)
            
            # Dibujar un radar holográfico
            centro = (320, 240)
            cv2.circle(frame_procesado, centro, 100, (0, 100, 0), 1)
            cv2.circle(frame_procesado, centro, 200, (0, 100, 0), 1)
            cv2.line(frame_procesado, (120, 240), (520, 240), (0, 100, 0), 1)
            cv2.line(frame_procesado, (320, 40), (320, 440), (0, 100, 0), 1)
            
            # Línea de barrido del radar
            x_radar = int(centro[0] + 200 * math.cos(math.radians(angulo_radar)))
            y_radar = int(centro[1] + 200 * math.sin(math.radians(angulo_radar)))
            cv2.line(frame_procesado, centro, (x_radar, y_radar), (0, 255, 0), 2)
            angulo_radar = (angulo_radar + 5) % 360
            
            # Partículas de "basura" detectadas
            for _ in range(int(llenado_actual / 5)):
                rx = random.randint(150, 490)
                ry = random.randint(70, 410)
                cv2.circle(frame_procesado, (rx, ry), 3, (0, 255, 255), -1)

            cv2.putText(frame_procesado, "[SIMULADOR SINTETICO ACTIVO]", (180, 460), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

        llenado_actual += random.uniform(0.1, 0.5)
        if llenado_actual > 100:
            llenado_actual = 100.0

        # Dibujar Interfaz
        cv2.putText(frame_procesado, "BraxRecicla AI - Analisis de Tolva", (10, 30), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                    
        cv2.putText(frame_procesado, f"Camion: {PATENTE_CAMION}", (10, 60), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                    
        cv2.rectangle(frame_procesado, (10, 80), (310, 110), (0, 50, 0), -1)
        cv2.rectangle(frame_procesado, (10, 80), (10 + int(llenado_actual * 3), 110), (0, 255, 0), -1)
        cv2.putText(frame_procesado, f"Llenado: {llenado_actual:.1f}%", (15, 102), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        cv2.imshow('BraxRecicla - Telemetria IoT (Raspberry Pi Simulada)', frame_procesado)

        tiempo_actual = time.time()
        if tiempo_actual - ultimo_envio > 5.0:
            enviar_telemetria_a_supabase(round(llenado_actual, 1))
            ultimo_envio = tiempo_actual

        if cv2.waitKey(50) & 0xFF == ord('q'):
            break

    cv2.destroyAllWindows()
    print("SISTEMA APAGADO")

if __name__ == "__main__":
    iniciar_camara_ia()
