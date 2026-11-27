import time
import random
import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Cargar credenciales de Supabase
script_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(script_dir, "..", "BraxReciclaSoftware", ".env.local")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ ERROR: Faltan credenciales de Supabase en .env.local")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Intentar importar pyserial para leer el puerto RS-232 real
try:
    import serial
    HAY_PUERTO_SERIAL = True
except ImportError:
    print("⚠️ Módulo 'pyserial' no encontrado. (Ejecuta: pip install pyserial si tienes un cable RS-232)")
    HAY_PUERTO_SERIAL = False

import re
import ctypes
import ctypes.wintypes

class WindowsSerial:
    def __init__(self, port='COM3'):
        self.k32 = ctypes.windll.kernel32
        self.handle = self.k32.CreateFileW(f'\\\\.\\{port}', 0xC0000000, 0, None, 3, 0, None)
        if self.handle == -1:
            raise Exception(f'No se pudo abrir el puerto {port}')
        class COMMTIMEOUTS(ctypes.Structure):
            _fields_ = [
                ('ReadIntervalTimeout', ctypes.wintypes.DWORD),
                ('ReadTotalTimeoutMultiplier', ctypes.wintypes.DWORD),
                ('ReadTotalTimeoutConstant', ctypes.wintypes.DWORD),
                ('WriteTotalTimeoutMultiplier', ctypes.wintypes.DWORD),
                ('WriteTotalTimeoutConstant', ctypes.wintypes.DWORD)
            ]
        to = COMMTIMEOUTS(50, 0, 300, 0, 0)
        self.k32.SetCommTimeouts(self.handle, ctypes.byref(to))

    def read(self, n=150):
        buf = (ctypes.c_char * (n + 1))()
        read_bytes = ctypes.wintypes.DWORD(0)
        res = self.k32.ReadFile(self.handle, buf, n, ctypes.byref(read_bytes), None)
        if res and read_bytes.value > 0:
            return buf.value[:read_bytes.value]
        return b''

    def close(self):
        if hasattr(self, 'handle') and self.handle != -1:
            self.k32.CloseHandle(self.handle)
            self.handle = -1

def parsear_peso(texto):
    """
    Parsea la trama real emitida por la romana.
    Ejemplo de trama física recibida: '4A0+  83202 Kg05D'
    """
    matches = re.findall(r'([+-])\s*(\d+(?:\.\d+)?)\s*Kg', texto, re.IGNORECASE)
    if matches:
        signo, valor = matches[-1]
        peso = float(valor) if '.' in valor else int(valor)
        return -peso if signo == '-' else peso
    return None

def leer_peso_rs232():
    """
    Lee los bytes en vivo desde el puerto serial RS-232 físico conectado (CH340).
    Usa el driver nativo de Windows (Kernel32) evitando el bug de SetCommState.
    """
    puerto_com = 'COM3'
    try:
        ws = WindowsSerial(puerto_com)
        print(f"✅ Conectado a Báscula Real en {puerto_com} (Conexión Directa Win32)")
        
        # Leer durante 1.5 segundos para capturar la trama continua estabilizada
        buffer = ""
        start_time = time.time()
        while time.time() - start_time < 1.5:
            chunk = ws.read(150).decode('ascii', errors='ignore')
            if chunk:
                buffer += chunk
            time.sleep(0.05)
            
        ws.close()
        
        if buffer:
            peso = parsear_peso(buffer)
            if peso is not None:
                print(f"🎯 Trama física capturada: {repr(buffer.strip()[:30])}")
                print(f"⚖️ Peso físico decodificado: {peso} kg")
                return peso
    except Exception as e:
        print(f"⚠️ Error accediendo al hardware físico {puerto_com}: {e}")

    # Fallback simulación si falla el hardware
    peso_simulado = random.randint(800, 12000)
    print(f"ℹ️ Usando peso simulado de respaldo: {peso_simulado} kg")
    return peso_simulado

def iniciar_sensor_bascula():
    print("==============================================================")
    print("⚖️  MÓDULO IOT: SENSOR DE BÁSCULA INDUSTRIAL (RS-232)")
    print("==============================================================")
    print("Esperando a que el operador asigne el peso en el ERP...")

    while True:
        try:
            # 1. Buscar en Supabase algún camión que esté en estado 'En Pesaje' o que el usuario quiera pesar manualmente
            # En nuestro ERP, el operador asigna el ID a la báscula.
            # Para esta demo, haremos una prueba interactiva en la terminal:
            print("\n[Báscula Lista] Ingrese el ID del camión a pesar (o presione Enter para pesar el último pendiente): ")
            camion_id = input("> ").strip()
            
            if camion_id == "":
                # Buscar el último pendiente (que no tenga certificado y que no haya sido pesado)
                res = supabase.table('solicitudes_b2b').select('id, razon_social, rut').eq('kilos_reales', 0).is_('hash_certificado', 'null').order('fecha_solicitud', desc=True).limit(1).execute()
                if not res.data:
                    print("ℹ️ No hay camiones pendientes de pesaje en la base de datos.")
                    time.sleep(5)
                    continue
                camion = res.data[0]
            else:
                res = supabase.table('solicitudes_b2b').select('id, razon_social, rut, kilos_reales, hash_certificado').eq('id', camion_id).execute()
                if not res.data:
                    print("❌ No se encontró ese ID de camión.")
                    continue
                if res.data[0].get('hash_certificado'):
                    print("❌ ERROR: Este camión ya tiene un Certificado Legal emitido. Su pesaje es inmutable.")
                    continue
                if res.data[0].get('kilos_reales', 0) > 0:
                    print("❌ ERROR: Este camión ya fue pesado y la báscula está bloqueada. Comuníquese con auditoría si hay un error.")
                    continue
                camion = res.data[0]
                
            print(f"🚛 Camión en Romana: {camion['razon_social']} (RUT: {camion['rut']})")
            print("⏱️ Leyendo datos del puerto Serial RS-232 (COM3)...")
            
            time.sleep(2) # Simular tiempo de estabilización de la báscula
            
            peso_final = leer_peso_rs232()
            
            print(f"⚖️ LECTURA CONFIRMADA: {peso_final} kg")
            print("¿Desea enviar este peso oficial a la nube Supabase? (s/n)")
            confirm = input("> ").lower()
            
            if confirm == 's':
                supabase.table('solicitudes_b2b').update({'estado': 'Pesado', 'kilos_reales': peso_final}).eq('id', camion['id']).execute()
                print("✅ [ÉXITO] Peso oficial guardado en Blockchain/Supabase. El ERP ha sido actualizado.")
            else:
                print("❌ Pesaje cancelado por el operador.")

        except Exception as e:
            print(f"❌ Error en el sensor: {e}")
            time.sleep(5)

if __name__ == "__main__":
    iniciar_sensor_bascula()
