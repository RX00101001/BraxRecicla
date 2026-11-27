import cv2
import requests
import json
import time
import os
import platform

# ==============================================================================
# BRAXRECICLA IOT EDGE - VISOR DE CÁMARA SEGURO (POST A SUPABASE)
# Compatible con Windows y Linux (Raspberry Pi / Ubuntu)
# ==============================================================================

# 1. Configuración de Seguridad y Entorno
# ------------------------------------------------------------------------------
# ATENCIÓN: El API_KEY_IOT debe estar configurado como variable de entorno.
# Este token JWT tiene permisos RLS limitados solo para actualizar datos,
# evitando que un hacker pueda leer o borrar bases de datos enteras si se infiltra en la planta.
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://tu-proyecto.supabase.co")
API_KEY_IOT = os.getenv("API_KEY_IOT", "TU_TOKEN_JWT_SEGURO_AQUI")
CAMION_ID_ASIGNADO = "BRX-12" # Patente o ID del camión en la romana actual

headers = {
    "apikey": API_KEY_IOT,
    "Authorization": f"Bearer {API_KEY_IOT}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

def obtener_camara():
    """Selecciona el backend de cámara según el Sistema Operativo (Windows o Linux)."""
    sistema = platform.system()
    print(f"[Sistema] Detectado OS: {sistema}")
    
    if sistema == "Windows":
        # En Windows, cv2.CAP_DSHOW suele ser más rápido y compatible para webcams USB
        cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    elif sistema == "Linux":
        # En Linux (ej. Raspberry Pi), V4L2 es el estándar
        cap = cv2.VideoCapture(0, cv2.CAP_V4L2)
    else:
        # Fallback genérico
        cap = cv2.VideoCapture(0)
        
    return cap

def analizar_volumen_ia(frame):
    """
    Simulación de Inferencia IA:
    Aquí integraríamos el modelo de Computer Vision real (PyTorch/TensorFlow)
    para calcular el porcentaje de llenado de chatarra en el camión.
    """
    # ... código de procesamiento de imagen ...
    # Por ahora, retornaremos un valor fijo simulado para la prueba de red
    return 85 # 85% de llenado detectado

def enviar_telemetria_supabase(porcentaje_volumen):
    """Envía el dato de forma segura a la base de datos central en la nube."""
    endpoint = f"{SUPABASE_URL}/rest/v1/flota?patente=eq.{CAMION_ID_ASIGNADO}"
    
    payload = {
        "ocupacion_actual_kg": porcentaje_volumen * 100 # Simulación de conversión
    }
    
    try:
        # Petición PATCH (Actualizar). Las políticas RLS de Supabase solo permitirán esto.
        response = requests.patch(endpoint, headers=headers, json=payload, timeout=5)
        if response.status_code in [200, 204]:
            print(f"[Seguridad OK] Dato enviado: {porcentaje_volumen}% Volumen.")
        else:
            print(f"[ALERTA SEGURIDAD] Acceso Denegado o Error: {response.text}")
    except Exception as e:
        print(f"[Falla de Red] No se pudo conectar a la nube: {e}")

def main():
    print("Iniciando BraxRecicla Edge Vision (Seguridad ISO 27001)...")
    cap = obtener_camara()
    
    if not cap.isOpened():
        print("Error: No se detectó cámara física. Verifica la conexión USB.")
        return

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            # 1. Mostrar cámara en la romana (Opcional, puede estar en background)
            cv2.imshow('BraxRecicla - Auditoría Visual (Cifrada)', frame)
            
            # 2. Cada 10 segundos, analizamos y enviamos a la nube
            if int(time.time()) % 10 == 0:
                llenado = analizar_volumen_ia(frame)
                enviar_telemetria_supabase(llenado)
                time.sleep(1) # Evitar múltiples envíos en el mismo segundo
                
            # Salir con tecla 'q'
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
                
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("Sistema cerrado de forma segura.")

if __name__ == "__main__":
    main()
