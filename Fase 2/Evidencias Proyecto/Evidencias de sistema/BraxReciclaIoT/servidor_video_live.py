import cv2
import numpy as np
import time
import os
import threading
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ==============================================================================
# BRAXRECICLA IOT - SERVIDOR DE VIDEO STREAMING EN TIEMPO REAL (MJPEG + IA 3D)
# Transmite video continuo en vivo hacia BraxPanel (http://localhost:5000/video_feed)
# ==============================================================================

PORT = 5000
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model-small.onnx")

class VideoStreamServer:
    def __init__(self):
        self.frame_jpeg = None
        self.lock = threading.Lock()
        self.running = True
        self.llenado_pct = 0.0
        self.estado_tolva = "TOLVA VACIA"
        self.fps = 0
        self.modo_vista = "dual" # "dual", "rgb", "depth"

stream_server = VideoStreamServer()

def abrir_camara():
    """Intenta abrir la cámara con tolerancia a microcortes."""
    for idx in [0, 1]:
        for api in [cv2.CAP_DSHOW, cv2.CAP_ANY]:
            try:
                cap = cv2.VideoCapture(idx, api)
                if cap.isOpened():
                    for _ in range(8):
                        ret, frame = cap.read()
                        if ret and frame is not None and frame.size > 0:
                            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                            return cap
                        time.sleep(0.04)
                    cap.release()
            except Exception:
                pass
    return None

def hilo_procesamiento_ia():
    """Captura video, ejecuta la red neuronal de profundidad 3D y genera el stream."""
    print("[*] Hilo de visión e IA iniciado...")
    
    # Cargar red neuronal MiDaS
    net = None
    if os.path.exists(MODEL_PATH):
        try:
            net = cv2.dnn.readNet(MODEL_PATH)
            net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
            print("[+] Red neuronal de profundidad cargada para el streaming.")
        except Exception as e:
            print(f"[!] Aviso: No se pudo cargar el modelo de profundidad: {e}")

    cap = abrir_camara()
    base_depth_calibrado = None
    fps_start = time.time()
    fps_counter = 0

    # Coordenadas relativas de la tolva (ROI)
    roi_top, roi_bottom = 0.20, 0.85
    roi_left, roi_right = 0.20, 0.80

    while stream_server.running:
        if cap is None or not cap.isOpened():
            time.sleep(0.5)
            cap = abrir_camara()
            if cap is None:
                # Generar cuadro sintético de espera si no hay cámara física
                placeholder = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(placeholder, "BRAXRECICLA AI - EN ESPERA DE CAMARA", (40, 230),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.putText(placeholder, "Conecte la camara USB o inicie DroidCam", (60, 270),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)
                _, jpeg = cv2.imencode('.jpg', placeholder, [cv2.IMWRITE_JPEG_QUALITY, 80])
                with stream_server.lock:
                    stream_server.frame_jpeg = jpeg.tobytes()
                continue

        ret, frame = cap.read()
        if not ret or frame is None or frame.size == 0:
            time.sleep(0.03)
            continue

        h, w = frame.shape[:2]
        ry1, ry2 = int(h * roi_top), int(h * roi_bottom)
        rx1, rx2 = int(w * roi_left), int(w * roi_right)

        # Si tenemos red de profundidad cargada, ejecutar inferencia
        if net is not None:
            img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            blob = cv2.dnn.blobFromImage(
                img_rgb, 1.0 / 255.0, (256, 256),
                (123.675, 116.28, 103.53), False, False
            )
            net.setInput(blob)
            depth_map = net.forward()[0]
            depth_full = cv2.resize(depth_map, (w, h))

            depth_min, depth_max = depth_full.min(), depth_full.max()
            if depth_max - depth_min > 1e-4:
                depth_norm = (depth_full - depth_min) / (depth_max - depth_min)
            else:
                depth_norm = np.zeros_like(depth_full)

            heatmap = cv2.applyColorMap((depth_norm * 255).astype(np.uint8), cv2.COLORMAP_TURBO)

            # Cálculo de % de llenado en la tolva
            roi_depth = depth_norm[ry1:ry2, rx1:rx2]
            avg_depth = float(np.mean(roi_depth))
            if base_depth_calibrado is None:
                base_depth_calibrado = avg_depth

            diff = avg_depth - base_depth_calibrado
            llenado = max(0.0, min(100.0, (diff / 0.35) * 100.0))
            stream_server.llenado_pct = round(llenado, 1)

            if llenado < 15:
                estado = "TOLVA VACIA"
                color_hud = (0, 255, 0)
            elif llenado < 75:
                estado = "CARGA PARCIAL"
                color_hud = (0, 220, 255)
            elif llenado < 90:
                estado = "LLENADO OPTIMO"
                color_hud = (0, 165, 255)
            else:
                estado = "SOBRECARGA"
                color_hud = (0, 0, 255)
            stream_server.estado_tolva = estado
        else:
            heatmap = frame.copy()
            color_hud = (0, 255, 0)
            estado = "MONITOREO ACTIVO"

        # Dibujar HUD en el cuadro
        vis = frame.copy()
        cv2.rectangle(vis, (rx1, ry1), (rx2, ry2), color_hud, 2)
        cv2.putText(vis, "TOLVA BRX-12", (rx1, ry1 - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color_hud, 2)

        # Barra de llenado
        cv2.rectangle(vis, (15, 15), (215, 38), (20, 20, 20), -1)
        bar_w = int(200 * (stream_server.llenado_pct / 100.0))
        cv2.rectangle(vis, (15, 15), (15 + bar_w, 38), color_hud, -1)
        cv2.rectangle(vis, (15, 15), (215, 38), (200, 200, 200), 1)
        cv2.putText(vis, f"LLENADO: {stream_server.llenado_pct}%", (25, 32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        # Insignia EN VIVO
        cv2.circle(vis, (w - 75, 25), 6, (0, 0, 255), -1)
        cv2.putText(vis, "EN VIVO", (w - 62, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)

        # Medir FPS
        fps_counter += 1
        if time.time() - fps_start >= 1.0:
            stream_server.fps = fps_counter
            fps_counter = 0
            fps_start = time.time()

        # Comprimir a JPEG para el streaming web
        # Vista dual lado a lado (640x2 + 360)
        salida = np.hstack((vis, cv2.resize(heatmap, (w, h))))
        # Redimensionar ligeramente para optimizar ancho de banda a 30 FPS
        salida_opt = cv2.resize(salida, (960, 360))

        _, jpeg = cv2.imencode('.jpg', salida_opt, [cv2.IMWRITE_JPEG_QUALITY, 75])
        with stream_server.lock:
            stream_server.frame_jpeg = jpeg.tobytes()

        time.sleep(0.03) # ~30 FPS

    if cap is not None:
        cap.release()

class StreamingHandler(BaseHTTPRequestHandler):
    """Manejador HTTP compatible con navegadores web (MJPEG + CORS)."""
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def do_GET(self):
        # 1. Flujo de video en vivo continuo
        if self.path.startswith('/video_feed'):
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, private')
            self.end_headers()

            while stream_server.running:
                with stream_server.lock:
                    frame = stream_server.frame_jpeg
                if frame is not None:
                    try:
                        self.wfile.write(b'--frame\r\n')
                        self.send_header('Content-Type', 'image/jpeg')
                        self.send_header('Content-Length', str(len(frame)))
                        self.end_headers()
                        self.wfile.write(frame)
                        self.wfile.write(b'\r\n')
                    except Exception:
                        break
                time.sleep(0.04) # ~25 FPS

        # 2. Endpoint de estado JSON
        elif self.path.startswith('/status'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            data = {
                "online": True,
                "camion": "BRX-12",
                "llenado_pct": stream_server.llenado_pct,
                "estado_tolva": stream_server.estado_tolva,
                "fps": stream_server.fps,
                "timestamp": time.time()
            }
            self.wfile.write(json.dumps(data).encode('utf-8'))

        # 3. Vista directa de prueba
        elif self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            html = f"""<!DOCTYPE html>
<html>
<head>
  <title>BraxRecicla - Streaming Video Tolva en Vivo</title>
  <style>
    body {{ margin:0; background:#0b0f19; color:#f8fafc; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; }}
    h1 {{ color:#10b981; margin-bottom:8px; font-size:20px; }}
    .badge {{ background:#ef4444; color:white; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:bold; display:inline-flex; align-items:center; gap:6px; margin-bottom:14px; }}
    .dot {{ width:8px; height:8px; background:white; border-radius:50%; }}
    .box {{ border:2px solid #1e293b; border-radius:16px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,0.5); max-width:960px; }}
    img {{ width:100%; height:auto; display:block; }}
  </style>
</head>
<body>
  <h1>BraxRecicla AI - Telemetr&iacute;a de Visi&oacute;n 3D</h1>
  <div class="badge"><div class="dot"></div> EN VIVO &middot; CAMI&Oacute;N BRX-12</div>
  <div class="box">
    <img src="/video_feed" alt="Video en Vivo" />
  </div>
</body>
</html>"""
            self.wfile.write(html.encode('utf-8'))
        else:
            self.send_error(404)

def main():
    print("=" * 65)
    print("  BRAXRECICLA - SERVIDOR DE VIDEO STREAMING EN VIVO (PUERTO 5000)")
    print("=" * 65)
    print(f"[*] Escuchando en: http://localhost:{PORT}")
    print(f"[*] Canal de video para BraxPanel: http://localhost:{PORT}/video_feed")
    print(f"[*] API de telemetría de visión: http://localhost:{PORT}/status")
    print("=" * 65)

    # Iniciar hilo de captura e inferencia IA
    hilo = threading.Thread(target=hilo_procesamiento_ia, daemon=True)
    hilo.start()

    server = ThreadingHTTPServer(('0.0.0.0', PORT), StreamingHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Deteniendo servidor de video...")
        stream_server.running = False
        server.server_close()
        print("[+] Servidor detenido.")

if __name__ == "__main__":
    main()
