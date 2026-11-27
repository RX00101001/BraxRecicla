import time
import re
import ctypes
import ctypes.wintypes

class WindowsSerial:
    def __init__(self, port='COM3'):
        self.k32 = ctypes.windll.kernel32
        self.handle = self.k32.CreateFileW(f'\\\\.\\{port}', 0xC0000000, 0, None, 3, 0, None)
        if self.handle == -1:
            raise Exception(f'No se pudo abrir el puerto {port}. Verifica que esté conectado.')
        
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
    matches = re.findall(r'([+-])\s*(\d+(?:\.\d+)?)\s*Kg', texto, re.IGNORECASE)
    if matches:
        signo, valor = matches[-1]
        peso = float(valor) if '.' in valor else int(valor)
        return -peso if signo == '-' else peso
    return None

def monitor():
    print("=" * 65)
    print("⚖️  MONITOR EN VIVO: BÁSCULA INDUSTRIAL ROMANA (RS-232)")
    print("=" * 65)
    print("Conexión directa vía Windows Kernel32 Driver (Sin errores de puerto)")
    print("Presiona Ctrl+C para salir.\n")

    puerto = 'COM3'
    try:
        ws = WindowsSerial(puerto)
        print(f"✅ Conectado a la Romana en {puerto} exitosamente.")
        print("📡 Leyendo flujo continuo de peso:\n")

        buffer = ""
        while True:
            chunk = ws.read(150).decode('ascii', errors='ignore')
            if chunk:
                buffer += chunk
                if len(buffer) > 200:
                    buffer = buffer[-200:]

                peso = parsear_peso(buffer)
                if peso is not None:
                    # Imprimir en consola en la misma línea con formato industrial
                    print(f"\r🚛 PESO ACTUAL EN ROMANA: [ {peso:>8} kg ]  |  Trama: {repr(chunk.strip()[:20])}", end="", flush=True)

            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\n\n⏹️ Monitor finalizado por el usuario.")
    except Exception as e:
        print(f"\n❌ Error de conexión: {e}")
    finally:
        try:
            ws.close()
        except:
            pass

if __name__ == "__main__":
    monitor()
