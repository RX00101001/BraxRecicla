import time
import serial
import serial.tools.list_ports

def buscar_puerto():
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        print("❌ No se detecta ningún puerto COM activo.")
        print("   Verifica que el cable USB-RS232 tenga el controlador instalado.")
        return None
    print("🔌 Puertos COM detectados:")
    for i, p in enumerate(ports):
        print(f"   [{i}] {p.device}: {p.description}")
    return ports[0].device

def probar_lectura(port_name, baudrates=[9600, 4800, 2400, 19200, 115200]):
    for baud in baudrates:
        print(f"\n📡 Probando conexión en {port_name} a {baud} baudios...")
        try:
            with serial.Serial(port_name, baud, timeout=2) as ser:
                # Esperar hasta 3 segundos para ver si la báscula transmite automáticamente
                start = time.time()
                recibido = b""
                while time.time() - start < 3:
                    if ser.in_waiting > 0:
                        recibido += ser.read(ser.in_waiting)
                    time.sleep(0.1)

                if recibido:
                    print(f"🎉 ¡DATOS RECIBIDOS a {baud} baudios!")
                    print(f"   Bytes brutos: {recibido}")
                    try:
                        texto = recibido.decode('ascii', errors='ignore').strip()
                        print(f"   Texto decodificado: '{texto}'")
                    except Exception as e:
                        pass
                    return baud, recibido
                else:
                    print("   (Sin transmisión automática, probando enviar comando 'W\\r\\n' / 'P\\r\\n')...")
                    ser.write(b"W\r\n")
                    time.sleep(0.5)
                    ser.write(b"P\r\n")
                    time.sleep(0.5)
                    if ser.in_waiting > 0:
                        recibido = ser.read(ser.in_waiting)
                        print(f"🎉 ¡RESPUESTA A COMANDO RECIBIDA a {baud} baudios!: {recibido}")
                        return baud, recibido
                    print(f"   Silencio en {baud}.")
        except Exception as e:
            print(f"   Error abriendo puerto: {e}")

    print("\n⚠️ No se detectó transmisión en los baudrates comunes.")
    return None, None

if __name__ == "__main__":
    print("=" * 60)
    print("⚖️  DIAGNÓSTICO EN VIVO: LECTURA DE BÁSCULA REAL (RS-232)")
    print("=" * 60)
    puerto = buscar_puerto()
    if puerto:
        probar_lectura(puerto)
