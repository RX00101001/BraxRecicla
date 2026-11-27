import cv2
import numpy as np
import time
import os

# ==============================================================================
# BRAXRECICLA AI - AGENTE DE VISIÓN Y ESTIMACIÓN DE PROFUNDIDAD 3D
# Modelo: Intel MiDaS v2.1 Small (Deep Monocular Depth Estimation)
# Auto-recuperación de señal y soporte de desconexión / flex de pantalla
# ==============================================================================

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model-small.onnx")

def abrir_camara():
    """Intenta abrir la cámara con reintentos para dar tiempo al sensor."""
    for idx in [0, 1]:
        for api, api_name in [(cv2.CAP_DSHOW, "DirectShow"), (cv2.CAP_ANY, "Default")]:
            try:
                cap = cv2.VideoCapture(idx, api)
                if cap.isOpened():
                    for _ in range(10):
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

def main():
    print("=" * 65)
    print("  BRAXRECICLA AI - AGENTE DE PROFUNDIDAD Y LLENADO DE TOLVA (3D)")
    print("=" * 65)
    print(f"[*] Cargando red neuronal de profundidad: {os.path.basename(MODEL_PATH)}...")
    
    if not os.path.exists(MODEL_PATH):
        print(f"[!] Error: No se encontró el modelo en {MODEL_PATH}")
        return

    net = cv2.dnn.readNet(MODEL_PATH)
    net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
    print("[+] Red neuronal cargada exitosamente.")

    print("[*] Conectando con la cámara...")
    cap = abrir_camara()
    if cap is None:
        print("[!] Esperando señal de cámara...")
    else:
        print("[+] Cámara conectada con éxito!")

    print("\n" + "=" * 65)
    print("  CONTROLES:")
    print("  - Presiona 'c': CALIBRAR TOLVA VACÍA (Guarda nivel base)")
    print("  - Presiona 'q': SALIR")
    print("=" * 65 + "\n")

    base_depth_calibrado = None
    fps_counter = 0
    fps_start = time.time()
    fps_text = "FPS: --"
    fallos_consecutivos = 0

    # Tolva ROI (Región de Interés central): [ymin, xmin, ymax, xmax] en %
    roi_top, roi_bottom = 0.20, 0.85
    roi_left, roi_right = 0.20, 0.80

    while True:
        # Si la cámara se desconectó o falló, intentar reconectar automáticamente
        if cap is None or not cap.isOpened():
            print("[*] Reconectando cámara automáticamente...")
            if cap is not None:
                cap.release()
            cap = abrir_camara()
            if cap is None:
                time.sleep(0.5)
                # Mostrar pantalla de reconexión
                aviso = np.zeros((480, 1280, 3), dtype=np.uint8)
                cv2.putText(aviso, "RECONECTANDO CAMARA... Mueve ligeramente la pantalla si parpadea", 
                            (100, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)
                cv2.imshow("BraxRecicla - Agente de Vision 3D y Profundidad", aviso)
                if cv2.waitKey(100) & 0xFF == ord('q'):
                    break
                continue

        ret, frame = cap.read()
        if not ret or frame is None or frame.size == 0:
            fallos_consecutivos += 1
            if fallos_consecutivos > 15:
                print("[!] Señal de video perdida. Reiniciando conexión con cámara...")
                cap.release()
                cap = None
                fallos_consecutivos = 0
            time.sleep(0.02)
            continue
        
        fallos_consecutivos = 0

        h, w = frame.shape[:2]
        ry1, ry2 = int(h * roi_top), int(h * roi_bottom)
        rx1, rx2 = int(w * roi_left), int(w * roi_right)

        brillo_medio = float(np.mean(frame))
        camara_a_oscuras = brillo_medio < 2.0

        # 1. Preprocesamiento para MiDaS (256x256 RGB normalizado)
        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        blob = cv2.dnn.blobFromImage(
            img_rgb, 
            scalefactor=1.0 / 255.0, 
            size=(256, 256), 
            mean=(123.675, 116.28, 103.53), 
            swapRB=False, 
            crop=False
        )

        # 2. Inferencia de Profundidad con IA
        net.setInput(blob)
        depth_map = net.forward()[0]  # Forma: (256, 256)

        # 3. Redimensionar mapa de profundidad al tamaño del frame original
        depth_full = cv2.resize(depth_map, (w, h), interpolation=cv2.INTER_CUBIC)

        # 4. Normalizar profundidad relativa (0 = lejano/fondo, 255 = cercano/elevado)
        depth_min = depth_full.min()
        depth_max = depth_full.max()
        if depth_max - depth_min > 1e-4:
            depth_norm = (depth_full - depth_min) / (depth_max - depth_min)
        else:
            depth_norm = np.zeros_like(depth_full)

        depth_vis = (depth_norm * 255).astype(np.uint8)
        # Aplicar mapa de color térmico 3D (TURBO: azul fondo -> rojo elevación)
        heatmap = cv2.applyColorMap(depth_vis, cv2.COLORMAP_TURBO)

        # 5. Cálculo de Llenado dentro de la Tolva (ROI)
        roi_depth = depth_norm[ry1:ry2, rx1:rx2]
        avg_depth_roi = float(np.mean(roi_depth))

        if base_depth_calibrado is None:
            base_depth_calibrado = avg_depth_roi

        # El porcentaje de llenado mide qué tan cerca está el material respecto al fondo
        diferencia = avg_depth_roi - base_depth_calibrado
        llenado_pct = max(0.0, min(100.0, (diferencia / 0.35) * 100.0))

        # Determinar estado de la carga
        if camara_a_oscuras:
            estado_tolva = "LENTE TAPADO / OSCURO"
            color_alerta = (0, 0, 255)
        elif llenado_pct < 15:
            estado_tolva = "TOLVA VACIA"
            color_alerta = (0, 255, 0)      # Verde
        elif llenado_pct < 75:
            estado_tolva = "CARGA PARCIAL"
            color_alerta = (0, 220, 255)    # Amarillo
        elif llenado_pct < 90:
            estado_tolva = "LLENADO OPTIMO"
            color_alerta = (0, 165, 255)    # Naranja
        else:
            estado_tolva = "SOBRECARGA"
            color_alerta = (0, 0, 255)      # Rojo

        # 6. Dibujar Interfaz HUD sobre la imagen RGB
        vis_frame = frame.copy()
        
        # Dibujar marco de la tolva (ROI)
        cv2.rectangle(vis_frame, (rx1, ry1), (rx2, ry2), color_alerta, 2)
        cv2.putText(vis_frame, "TOLVA (ZONA MONITOREADA)", (rx1, ry1 - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color_alerta, 2)

        # Barra gráfica de nivel de llenado
        bar_x1, bar_y1 = 20, 90
        bar_x2, bar_y2 = 220, 115
        cv2.rectangle(vis_frame, (bar_x1, bar_y1), (bar_x2, bar_y2), (40, 40, 40), -1)
        bar_fill = int((bar_x2 - bar_x1) * (llenado_pct / 100.0))
        cv2.rectangle(vis_frame, (bar_x1, bar_y1), (bar_x1 + bar_fill, bar_y2), color_alerta, -1)
        cv2.rectangle(vis_frame, (bar_x1, bar_y1), (bar_x2, bar_y2), (200, 200, 200), 1)

        # Textos informativos
        cv2.putText(vis_frame, f"LLENADO: {llenado_pct:.1f}%", (bar_x1 + 10, bar_y2 - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.putText(vis_frame, f"ESTADO: {estado_tolva}", (20, 140),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_alerta, 2)
        cv2.putText(vis_frame, "BraxRecicla AI - Vision 3D", (20, 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.putText(vis_frame, f"[Tecla 'C']: Calibrar Fondo  |  {fps_text}", (20, 65),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)

        if camara_a_oscuras:
            cv2.putText(vis_frame, "AVISO: LENTE TAPADO O SWITCH CERRADO", (20, 175),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 140, 255), 2)

        # Dibujar ROI también en el mapa de calor
        cv2.rectangle(heatmap, (rx1, ry1), (rx2, ry2), (255, 255, 255), 1)
        cv2.putText(heatmap, "MAPA DE PROFUNDIDAD IA (3D)", (20, 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(heatmap, "Azul=Fondo Lejano  |  Rojo=Elevacion Cercana", (20, 65),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)

        # Unir ambas vistas lado a lado (Pantalla dual: RGB + Heatmap 3D)
        pantalla_dual = np.hstack((vis_frame, heatmap))

        # Medir FPS
        fps_counter += 1
        if time.time() - fps_start >= 1.0:
            fps_text = f"FPS: {fps_counter}"
            fps_counter = 0
            fps_start = time.time()

        # Mostrar ventana
        cv2.imshow("BraxRecicla - Agente de Vision 3D y Profundidad", pantalla_dual)

        tecla = cv2.waitKey(1) & 0xFF
        if tecla == ord('q'):
            break
        elif tecla == ord('c'):
            base_depth_calibrado = avg_depth_roi
            print(f"[*] Tolva recalibrada. Nuevo nivel base fondo: {base_depth_calibrado:.3f}")

    if cap is not None:
        cap.release()
    cv2.destroyAllWindows()
    print("[*] Agente de visión cerrado limpiamente.")

if __name__ == "__main__":
    main()
