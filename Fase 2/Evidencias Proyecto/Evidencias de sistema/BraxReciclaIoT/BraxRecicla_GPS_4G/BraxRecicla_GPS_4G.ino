/*
 * ============================================================================
 *  BRAXRECICLA IoT - Telemetría GPS + Retransmisión 4G LTE (Supabase)
 * ============================================================================
 *  Hardware:
 *    - Placa: LilyGO T-A7670G (ESP32-D0WD-V3 + Módem SIMCom A7670G 4G LTE)
 *    - GPS:   Quectel L76K (UART 9600 baud)
 *
 *  Configuración recomendada en Arduino IDE:
 *    - Placa:            ESP32 Wrover Module
 *    - Upload Speed:     921600
 *    - Flash Frequency:  80MHz
 *    - Flash Mode:       QIO
 *    - Partition Scheme: Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)
 *    - Port:             COM4 (ajustar según PC)
 *
 *  Librerías necesarias:
 *    - TinyGPSPlus (por Mikal Hart) -> Instalar desde Gestor de Bibliotecas
 *    - WiFi.h, WebServer.h           -> Incluidas en el core esp32 (v3.3.12)
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <TinyGPSPlus.h>

// ============================================================================
//  1. CONFIGURACIÓN DE HARDWARE Y RED (Recuperada de tu placa + verificada)
// ============================================================================
// Monitor de batería (divisor resistivo en LilyGO T-A7670)
constexpr int PIN_BAT_ADC       = 35;

// Control de energía de la placa y periféricos
constexpr int PIN_BOARD_POWER   = 12;   // Habilita alimentación principal en LilyGO
constexpr int PIN_PERIPH_POWER  = 19;   // Pin en HIGH presente en tu sketch original (GPS/periférico)
constexpr int PIN_MODEM_PWRKEY  = 4;    // Pulso de encendido SIMCom A7670G

// UART1 -> GPS Quectel L76K
constexpr int PIN_GPS_RX        = 22;   // ESP32 RX1 <- TX del L76K
constexpr int PIN_GPS_TX        = 21;   // ESP32 TX1 -> RX del L76K
constexpr uint32_t GPS_BAUD     = 9600;

// UART2 -> Módem 4G SIMCom A7670G
constexpr int PIN_MODEM_RX      = 27;   // ESP32 RX2 <- TX del A7670G
constexpr int PIN_MODEM_TX      = 26;   // ESP32 TX2 -> RX del A7670G
constexpr uint32_t MODEM_BAUD   = 115200;

// Red celular Entel Chile (SIM móvil/prepago usa imovil.entelpcs.cl; BAM usa bam.entelpcs.cl)
const char* APN_ENTEL           = "imovil.entelpcs.cl";
const char* APN_USER            = "entelpcs";
const char* APN_PASS            = "entelpcs";

// Punto de acceso Wi-Fi local (Panel de diagnóstico http://192.168.4.1)
const char* WIFI_AP_SSID        = "BraxRecicla-GPS";
const char* WIFI_AP_PASS        = "12345678";

// Identificador de flota y endpoint Supabase (tabla telemetria_flota)
const char* PATENTE_CAMION      = "BRX-12";
const char* SUPABASE_URL        = "https://raexkgrfehsgbbxybhlw.supabase.co/rest/v1/telemetria_flota?apikey=sb_publishable_waBqMs26qUy79s2d1gsL3A_tVRnAv0Q";

// Coordenadas de respaldo usadas SOLO al presionar "Forzar Envío 4G" sin fix satelital
constexpr double FALLBACK_LAT   = -33.456940;
constexpr double FALLBACK_LON   = -70.648270;

// Tiempos del ciclo principal
constexpr uint32_t INTERVALO_ENVIO_MS = 15000UL;  // Envío automático cada 15 s con GPS válido
constexpr uint32_t INTERVALO_LOG_MS   = 3000UL;   // Log serie cada 3 s cuando hay fix GPS

// Activar logs detallados de comandos AT (true recomendado durante pruebas)
#define DEBUG_AT true

// ============================================================================
//  2. VARIABLES GLOBALES
// ============================================================================
TinyGPSPlus gps;
WebServer server(80);

float   bateriaV        = 0.0f;
int     bateriaPct      = 0;
bool    modemOk         = false;
String  senal4G         = "Verificando...";
String  nubeStatus      = "Iniciando módem 4G...";
unsigned long bytesNMEA = 0;

uint32_t ultimoEnvioMs  = 0;
uint32_t ultimoLogMs    = 0;

// ============================================================================
//  3. INTERFAZ WEB LOCAL (Panel Wi-Fi http://192.168.4.1)
// ============================================================================
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BraxRecicla GPS 4G</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 15px; text-align: center; }
    .card { background: #1e293b; border-radius: 16px; padding: 18px; max-width: 420px; margin: 0 auto; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; }
    h1 { font-size: 20px; margin-bottom: 2px; color: #38bdf8; }
    .subtitle { font-size: 12px; color: #94a3b8; margin-bottom: 12px; }
    .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; background: #0f172a; padding: 8px 14px; border-radius: 10px; border: 1px solid #334155; }
    .cloud-box { margin-bottom: 10px; background: #022c22; border: 1px solid #059669; color: #a7f3d0; padding: 10px; border-radius: 8px; font-size: 12px; font-weight: bold; word-break: break-word; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-bottom: 12px; }
    .badge-searching { background: #f59e0b; color: #000; }
    .badge-locked { background: #10b981; color: #fff; }
    .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
    .metric { background: #0f172a; padding: 12px; border-radius: 12px; border: 1px solid #334155; }
    .metric-title { font-size: 11px; color: #94a3b8; text-transform: uppercase; }
    .metric-value { font-size: 26px; font-weight: 800; color: #38bdf8; margin: 4px 0; }
    .metric-unit { font-size: 11px; color: #94a3b8; }
    .metric-full { background: #0f172a; padding: 12px; border-radius: 12px; border: 1px solid #334155; margin: 10px 0; }
    .coords { font-size: 13px; color: #cbd5e1; }
    .btn-send { width: 100%; background: #059669; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: bold; margin-top: 10px; font-size: 13px; cursor: pointer; }
    .btn-send:hover { background: #10b981; }
    .btn-maps { display: none; background: #2563eb; color: #fff; text-decoration: none; padding: 10px; border-radius: 8px; font-weight: bold; margin-top: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>♻️ BraxRecicla IoT</h1>
    <div class="subtitle">Camión: BRX-12 | Módem Entel 4G LTE</div>

    <div class="top-bar">
      <div id="batLabel" style="font-size: 13px; font-weight: bold; color: #38bdf8;">🔋 Batería: --%</div>
      <div id="signal4G" style="font-size: 11px; color: #38bdf8;">📶 Entel: --</div>
    </div>

    <div id="cloudStatus" class="cloud-box">☁️ Supabase: Conectando...</div>
    <div id="statusBadge" class="badge badge-searching">⏳ Buscando Satélites...</div>

    <div class="metric-grid">
      <div class="metric">
        <div class="metric-title">Velocidad</div>
        <div id="valSpeed" class="metric-value">0.0</div>
        <div class="metric-unit">km / h</div>
      </div>
      <div class="metric">
        <div class="metric-title">Satélites</div>
        <div id="valSats" class="metric-value">0</div>
        <div class="metric-unit">Enlazados</div>
      </div>
    </div>

    <div class="metric-full">
      <div class="metric-title">Posición Satelital</div>
      <div id="valCoords" class="coords" style="margin-top: 5px;">Esperando triangulación...</div>
      <div id="valAlt" class="metric-unit" style="margin-top: 3px;">Altitud: -- m | NMEA: <span id="valBytes">0</span> B</div>
    </div>

    <button id="btnForzar" class="btn-send" onclick="forzarEnvio()">🚀 Forzar Envío 4G Ahora</button>
    <a id="btnMaps" class="btn-maps" target="_blank" href="#">📍 Ver en Google Maps</a>
  </div>

  <script>
    function updateData() {
      fetch('/data')
        .then(res => res.json())
        .then(d => {
          document.getElementById('valSpeed').innerText = d.velocidad;
          document.getElementById('valSats').innerText = d.satelites;
          document.getElementById('cloudStatus').innerText = "☁️ Supabase: " + d.nube_status;
          document.getElementById('signal4G').innerText = "📶 Entel: " + d.senal_4g;

          const batLabel = document.getElementById('batLabel');
          let batIcon = d.bateria_pct <= 20 ? "🪫" : "🔋";
          batLabel.innerText = batIcon + " Batería: " + d.bateria_pct + "% (" + d.bateria_v + "V)";

          const badge = document.getElementById('statusBadge');
          const btn = document.getElementById('btnMaps');

          if (d.fijado) {
            badge.className = "badge badge-locked";
            badge.innerText = "✅ GPS FIJADO (" + d.satelites + " satélites)";
            document.getElementById('valCoords').innerText = d.lat + ", " + d.lon;
            document.getElementById('valAlt').innerHTML = "Altitud: " + d.altitud + " m | NMEA: <span id='valBytes'>" + d.bytes_nmea + "</span> B";
            btn.href = d.maps_url;
            btn.style.display = "block";
          } else {
            badge.className = "badge badge-searching";
            badge.innerText = "⏳ Triangulando (" + d.satelites + " satélites)";
            document.getElementById('valCoords').innerText = "Antena apuntando al cielo";
            document.getElementById('valAlt').innerHTML = "Altitud: -- m | NMEA: <span id='valBytes'>" + d.bytes_nmea + "</span> B";
            btn.style.display = "none";
          }
        })
        .catch(err => console.log(err));
    }

    function forzarEnvio() {
      const btn = document.getElementById('btnForzar');
      btn.innerText = "⏳ Transmitiendo a Supabase...";
      btn.disabled = true;
      fetch('/forzar')
        .then(res => res.json())
        .then(d => {
          alert("Resultado 4G: " + d.status);
          btn.innerText = "🚀 Forzar Envío 4G Ahora";
          btn.disabled = false;
          updateData();
        })
        .catch(e => {
          alert("Error de conexión local");
          btn.innerText = "🚀 Forzar Envío 4G Ahora";
          btn.disabled = false;
        });
    }

    setInterval(updateData, 2000);
    updateData();
  </script>
</body>
</html>
)rawliteral";

// ============================================================================
//  4. FUNCIONES AUXILIARES (GPS, Batería, JSON y Comandos AT)
// ============================================================================

// Drena el puerto del GPS sin bloquear para no perder tramas NMEA durante esperas 4G
void bombearGPS() {
  while (Serial1.available() > 0) {
    char c = (char)Serial1.read();
    gps.encode(c);
    bytesNMEA++;
  }
}

void esperaConGPS(uint32_t ms) {
  uint32_t inicio = millis();
  while (millis() - inicio < ms) {
    bombearGPS();
    delay(5);
  }
}

String escaparJSON(String s) {
  s.replace("\\", "\\\\");
  s.replace("\"", "\\\"");
  s.replace("\r", " ");
  s.replace("\n", " ");
  s.trim();
  return s;
}

void leerBateria() {
  uint32_t suma = 0;
  for (int i = 0; i < 16; i++) {
    suma += analogRead(PIN_BAT_ADC);
    delay(2);
  }
  double prom = (double)suma / 16.0;
  // Calibración típica LilyGO T-A7670: divisor 100k/100k (x2) sobre Vref 3.3V / 12-bit ADC
  double volt = (prom / 4095.0) * 3.3 * 2.0;
  bateriaV = (float)volt;

  if (volt >= 4.2) {
    bateriaPct = 100;
  } else if (volt <= 3.3) {
    bateriaPct = 0;
  } else {
    bateriaPct = (int)(((volt - 3.3) / 0.9) * 100.0);
  }
}

void limpiarBufferModem() {
  while (Serial2.available() > 0) {
    Serial2.read();
  }
}

// Envía comando AT y espera hasta ver 'tokenExito', 'ERROR', '+CME ERROR' o timeout
String enviarAT(const String& cmd, uint32_t timeoutMs, const String& tokenExito = "OK") {
  limpiarBufferModem();

  if (DEBUG_AT && cmd.length() > 0) {
    Serial.printf("[AT >>] %s\n", cmd.c_str());
  }

  if (cmd.length() > 0) {
    Serial2.println(cmd);
    Serial2.flush();
  }

  String resp = "";
  uint32_t inicio = millis();
  while (millis() - inicio < timeoutMs) {
    bombearGPS();
    while (Serial2.available() > 0) {
      char c = (char)Serial2.read();
      resp += c;
    }
    if (tokenExito.length() > 0 && resp.indexOf(tokenExito) != -1) {
      // Pequeña pausa para terminar de recibir fin de línea
      esperaConGPS(20);
      while (Serial2.available() > 0) {
        resp += (char)Serial2.read();
      }
      break;
    }
    if (resp.indexOf("\nERROR") != -1 || resp.indexOf("\rERROR") != -1 ||
        resp == "ERROR" || resp.indexOf("+CME ERROR:") != -1) {
      esperaConGPS(20);
      while (Serial2.available() > 0) {
        resp += (char)Serial2.read();
      }
      break;
    }
    delay(5);
  }

  if (DEBUG_AT) {
    String logResp = resp;
    logResp.replace("\r", "");
    logResp.trim();
    Serial.printf("[AT <<] %s\n", logResp.length() > 0 ? logResp.c_str() : "(sin respuesta / timeout)");
  }

  return resp;
}

// Espera específicamente el URC asíncrono "+HTTPACTION: <method>,<code >,<len>"
bool esperarHTTPAction(uint32_t timeoutMs, int& outCode, int& outLen, String& outRaw) {
  outCode = -1;
  outLen = 0;
  outRaw = "";

  uint32_t inicio = millis();
  while (millis() - inicio < timeoutMs) {
    bombearGPS();
    while (Serial2.available() > 0) {
      char c = (char)Serial2.read();
      outRaw += c;
    }

    int idx = outRaw.indexOf("+HTTPACTION:");
    if (idx != -1) {
      int nl = outRaw.indexOf('\n', idx);
      if (nl != -1) {
        String linea = outRaw.substring(idx, nl);
        linea.trim();
        if (DEBUG_AT) {
          Serial.printf("[AT URC] %s\n", linea.c_str());
        }
        // Formato esperado: +HTTPACTION: 1,201,123
        int c1 = linea.indexOf(',');
        int c2 = (c1 != -1) ? linea.indexOf(',', c1 + 1) : -1;
        if (c1 != -1 && c2 != -1) {
          outCode = linea.substring(c1 + 1, c2).toInt();
          outLen  = linea.substring(c2 + 1).toInt();
          return true;
        }
      }
    }

    // Si el módem reportó error fatal inmediato antes del URC
    if (outRaw.indexOf("+CME ERROR:") != -1 ||
        outRaw.indexOf("\nERROR") != -1 ||
        outRaw.indexOf("\rERROR") != -1) {
      break;
    }

    delay(10);
  }

  if (DEBUG_AT) {
    String rawTrim = outRaw;
    rawTrim.replace("\r", "");
    rawTrim.trim();
    Serial.printf("[AT URC TIMEOUT] Recibido hasta ahora: %s\n",
                  rawTrim.length() > 0 ? rawTrim.c_str() : "(nada)");
  }
  return false;
}

// ============================================================================
//  5. MÓDEM 4G SIMCOM A7670G & CONECTIVIDAD ENTEL
// ============================================================================
void actualizarSenal4G() {
  String r = enviarAT("AT+CSQ", 800);
  int idx = r.indexOf("+CSQ: ");
  if (idx == -1) {
    senal4G = "Buscando antena...";
    return;
  }

  int coma = r.indexOf(',', idx + 6);
  if (coma == -1) {
    senal4G = "Buscando antena...";
    return;
  }

  int csq = r.substring(idx + 6, coma).toInt();
  if (csq == 99 || csq < 0 || csq > 31) {
    senal4G = "Sin señal (99)";
    return;
  }

  int pct = (csq * 100) / 31;
  String gatt = enviarAT("AT+CGATT?", 800);
  String estadoRed = (gatt.indexOf("+CGATT: 1") != -1) ? " [4G OK]" : " [Registrando...]";
  senal4G = String(csq) + "/31 (" + String(pct) + "%)" + estadoRed;
}

bool renovarSesion4G() {
  Serial.println("[4G] Renegociando sesión PDP Entel (CFUN=4 -> CFUN=1)...");
  enviarAT("AT+HTTPTERM", 800);
  enviarAT("AT+CFUN=4", 6000);
  esperaConGPS(500);

  enviarAT(String("AT+CGDCONT=1,\"IP\",\"") + APN_ENTEL + "\"", 1500);
  enviarAT(String("AT+CGAUTH=1,1,\"") + APN_USER + "\",\"" + APN_PASS + "\"", 1500);
  enviarAT("AT+CFUN=1", 6000);
  esperaConGPS(500);

  for (int seg = 1; seg <= 20; seg++) {
    String gatt = enviarAT("AT+CGATT?", 1000);
    if (gatt.indexOf("+CGATT: 1") != -1) {
      Serial.printf("[4G] Sesión Entel re-registrada en %d s.\n", seg);
      break;
    }
    esperaConGPS(1000);
  }

  String addr = enviarAT("AT+CGPADDR=1", 1000);
  enviarAT("AT+CGCONTRDP=1", 1200);
  esperaConGPS(1500);  // Da tiempo a que se estabilice el bearer (p.ej. +CGEV PDN 8)
  return (addr.indexOf("+CGPADDR: 1,") != -1 &&
          addr.indexOf('.') != -1 &&
          addr.indexOf("0.0.0.0") == -1);
}

bool asegurarPDPActivo() {
  String cgd = enviarAT("AT+CGDCONT?", 1000);
  bool apnCorrecto = (cgd.indexOf(String("+CGDCONT: 1,\"IP\",\"") + APN_ENTEL) != -1);

  String addr = enviarAT("AT+CGPADDR=1", 1000);
  bool ipValida = (addr.indexOf("+CGPADDR: 1,") != -1 &&
                   addr.indexOf('.') != -1 &&
                   addr.indexOf("0.0.0.0") == -1);
  // Entel suele asignar pool 100.64.x.x sin salida DNS/HTTP en el attach inicial;
  // al renegociar con CFUN=4/1 entrega IP 10.x.x.x enrutable.
  bool ipCGNAT = (addr.indexOf(",100.") != -1 || addr.indexOf("\"100.") != -1);

  if (apnCorrecto && ipValida && !ipCGNAT) {
    return true;
  }

  return renovarSesion4G();
}

void iniciarModem4G() {
  Serial.println("[4G ENTEL] Verificando comunicación con módem...");
  modemOk = false;

  for (int i = 0; i < 4; i++) {
    String r = enviarAT("AT", 800);
    if (r.indexOf("OK") != -1) {
      modemOk = true;
      break;
    }
    esperaConGPS(250);
  }

  if (!modemOk) {
    Serial.println("[4G] Enviando pulso de encendido PWRKEY (300ms)...");
    pinMode(PIN_MODEM_PWRKEY, OUTPUT);
    digitalWrite(PIN_MODEM_PWRKEY, LOW);
    delay(100);
    digitalWrite(PIN_MODEM_PWRKEY, HIGH);
    delay(300);
    digitalWrite(PIN_MODEM_PWRKEY, LOW);
    esperaConGPS(5000);

    for (int i = 0; i < 6; i++) {
      String r = enviarAT("AT", 1000);
      if (r.indexOf("OK") != -1) {
        modemOk = true;
        break;
      }
      esperaConGPS(1000);
    }
  }

  if (!modemOk) {
    Serial.println("[4G ERROR] El módem no respondió a comandos AT.");
    nubeStatus = "⚠️ Módem 4G no respondió";
    return;
  }

  Serial.println("[4G] Módem responde OK. Conectando a red celular Entel...");
  enviarAT("ATE0", 500);

  // Esperar registro de paquetes LTE (hasta 30s)
  for (int seg = 1; seg <= 30; seg++) {
    String gatt = enviarAT("AT+CGATT?", 1000);
    if (gatt.indexOf("+CGATT: 1") != -1) {
      Serial.printf("[4G] ¡Registrado en red Entel en %d segundos!\n", seg);
      break;
    }
    if (seg % 5 == 0) {
      enviarAT("AT+CEREG?", 800);
    }
    esperaConGPS(1000);
  }

  // Asegura APN correcto (imovil.entelpcs.cl) y credenciales PAP
  asegurarPDPActivo();
  enviarAT("AT+CGCONTRDP=1", 1200);

  // Perfil SSL 0 para HTTPS (TLS ALL + SNI + ignorelocaltime obligatorio por reloj 1970)
  enviarAT("AT+CSSLCFG=\"sslversion\",0,4", 500);
  enviarAT("AT+CSSLCFG=\"authmode\",0,0", 500);
  enviarAT("AT+CSSLCFG=\"enableSNI\",0,1", 500);
  enviarAT("AT+CSSLCFG=\"ignorelocaltime\",0,1", 500);
  enviarAT("AT+CSSLCFG=\"ignorecertCN\",0,1", 500);
  enviarAT("AT+CSSLCFG=\"negotiatetime\",0,60", 500);

  actualizarSenal4G();
  nubeStatus = "4G Entel Conectado (" + senal4G + ")";
  Serial.printf("[4G] Red Entel configurada. Señal: %s\n", senal4G.c_str());
}

// ============================================================================
//  6. ENVÍO HTTPS POST A SUPABASE (Secuencia corregida para SIMCom A7670G)
// ============================================================================
bool intentarPostHTTP(const String& json, int& outCode, String& outDetalle) {
  outCode = -1;
  outDetalle = "";

  // Cerrar sesión HTTP previa si quedó abierta
  enviarAT("AT+HTTPTERM", 800);
  esperaConGPS(100);

  // 1) Iniciar pila HTTP primero (orden obligatorio en SIMCom A76XX)
  String initResp = enviarAT("AT+HTTPINIT", 2500);
  if (initResp.indexOf("OK") == -1) {
    esperaConGPS(300);
    enviarAT("AT+HTTPTERM", 800);
    initResp = enviarAT("AT+HTTPINIT", 2500);
    if (initResp.indexOf("OK") == -1) {
      // Verifica si el módem dejó de responder AT para auto-recuperarlo luego
      if (enviarAT("AT", 800).indexOf("OK") == -1) {
        modemOk = false;
      }
      outDetalle = "HTTPINIT falló";
      return false;
    }
  }

  // 2) Configurar SSL (nota: NO usar AT+HTTPPARA="CID",1 porque es de SIM800 y falla en A7670G)
  enviarAT("AT+CSSLCFG=\"sslversion\",0,4", 500);
  enviarAT("AT+CSSLCFG=\"authmode\",0,0", 500);
  enviarAT("AT+CSSLCFG=\"enableSNI\",0,1", 500);
  enviarAT("AT+CSSLCFG=\"ignorelocaltime\",0,1", 500);
  enviarAT("AT+CSSLCFG=\"ignorecertCN\",0,1", 500);
  enviarAT("AT+CSSLCFG=\"negotiatetime\",0,60", 500);

  String sslResp = enviarAT("AT+HTTPPARA=\"SSLCFG\",0", 800);
  if (sslResp.indexOf("OK") == -1) {
    Serial.println("[4G SUPABASE] Aviso: HTTPPARA SSLCFG no devolvió OK.");
  }

  // 3) Configurar URL y Content-Type
  String urlCmd = String("AT+HTTPPARA=\"URL\",\"") + SUPABASE_URL + "\"";
  String urlResp = enviarAT(urlCmd, 1000);
  if (urlResp.indexOf("OK") == -1) {
    enviarAT("AT+HTTPTERM", 800);
    outDetalle = "URL rechazada";
    return false;
  }

  String ctResp = enviarAT("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 800);
  if (ctResp.indexOf("OK") == -1) {
    enviarAT("AT+HTTPTERM", 800);
    outDetalle = "CONTENT rechazado";
    return false;
  }

  // 4) Solicitar modo carga y ESPERAR el prompt "DOWNLOAD" antes de enviar el JSON
  String hdCmd = "AT+HTTPDATA=" + String(json.length()) + ",10000";
  String hdResp = enviarAT(hdCmd, 3000, "DOWNLOAD");
  if (hdResp.indexOf("DOWNLOAD") == -1) {
    enviarAT("AT+HTTPTERM", 800);
    outDetalle = "Sin prompt DOWNLOAD";
    return false;
  }

  // Enviar exactamente json.length() bytes sin salto de línea extra
  Serial2.print(json);
  Serial2.flush();
  String loadOk = enviarAT("", 3000, "OK");
  if (loadOk.indexOf("OK") == -1) {
    enviarAT("AT+HTTPTERM", 800);
    outDetalle = "Timeout carga JSON";
    return false;
  }

  // 5) Disparar POST y esperar URC asíncrono +HTTPACTION: 1,<httpCode>,<respLen>
  String actAck = enviarAT("AT+HTTPACTION=1", 3000, "OK");
  if (actAck.indexOf("OK") == -1) {
    enviarAT("AT+HTTPTERM", 800);
    outDetalle = "HTTPACTION rechazado";
    return false;
  }

  int respLen = 0;
  String rawAction = "";
  bool gotAction = esperarHTTPAction(25000, outCode, respLen, rawAction);

  String respBody = "";
  if (gotAction && respLen > 0) {
    int toRead = (respLen > 512) ? 512 : respLen;
    respBody = enviarAT("AT+HTTPREAD=0," + String(toRead), 3000);
  }

  enviarAT("AT+HTTPTERM", 1000);

  if (gotAction && (outCode == 200 || outCode == 201)) {
    return true;
  }

  if (gotAction) {
    respBody.replace("\r", "");
    respBody.replace("\n", " ");
    respBody.trim();
    outDetalle = "HTTP " + String(outCode);
    if (respBody.length() > 0) {
      outDetalle += " -> " + respBody;
    }
  } else {
    rawAction.replace("\r", "");
    rawAction.replace("\n", " ");
    rawAction.trim();
    outDetalle = rawAction.length() > 0 ? rawAction : "Timeout esperando +HTTPACTION (25s)";
  }
  return false;
}

bool enviarASupabase(double lat, double lon, int batPct, float batV, double velocidadKmh, uint32_t satelites) {
  if (!modemOk) {
    Serial.println("[4G SUPABASE] Módem no estaba listo. Reintentando iniciar...");
    nubeStatus = "⚠️ Módem no listo. Reintentando iniciar...";
    iniciarModem4G();
    if (!modemOk) {
      nubeStatus = "⚠️ Error 4G: Módem sin respuesta AT";
      return false;
    }
  }

  Serial.println("[4G SUPABASE] Transmitiendo telemetría a la nube...");
  nubeStatus = "Enviando paquete a Supabase...";

  if (!asegurarPDPActivo()) {
    Serial.println("[4G SUPABASE] Fallo PDP: Sin dirección IP celular.");
    nubeStatus = "⚠️ Error 4G: Sin IP de datos (PDP)";
    return false;
  }

  // Construir payload JSON exacto según tabla telemetria_flota (Opción A)
  // Nunca etiquetar el punto fijo de respaldo ni un fix antiguo como GPS real.
  bool gpsReal = gps.location.isValid() && gps.location.age() < 120000
                 && fabs(lat - gps.location.lat()) < 0.000001
                 && fabs(lon - gps.location.lng()) < 0.000001;
  String json = "{\"patente_camion\":\"" + String(PATENTE_CAMION) + "\","
                "\"fuente_ubicacion\":\"" + String(gpsReal ? "gps" : "desconocida") + "\","
                "\"latitud\":" + String(lat, 6) + ","
                "\"longitud\":" + String(lon, 6) + ","
                "\"bateria_pct\":" + String(batPct) + ","
                "\"bateria_v\":" + String(batV, 2) + ","
                "\"velocidad_kmh\":" + String(velocidadKmh, 1) + ","
                "\"satelites\":" + String(satelites) + "}";

  if (DEBUG_AT) {
    Serial.printf("[JSON %u B] %s\n", (unsigned)json.length(), json.c_str());
  }

  int httpCode = -1;
  String detalle = "";
  bool ok = intentarPostHTTP(json, httpCode, detalle);

  // Auto-recuperación si falló por DNS/socket/TLS (713/714/715) o módem colgado
  if (!ok && (httpCode == 713 || httpCode == 714 || httpCode == 715 || httpCode == -1)) {
    Serial.printf("[4G AUTO-RECUPERACION] %s -> recuperando módem/sesión y reintentando...\n",
                  detalle.c_str());
    if (!modemOk || enviarAT("AT", 800).indexOf("OK") == -1) {
      modemOk = false;
      iniciarModem4G();
      if (modemOk && asegurarPDPActivo()) {
        ok = intentarPostHTTP(json, httpCode, detalle);
      }
    } else {
      // Reintenta una vez en la misma sesión PDP antes de forzar CFUN=4/1
      esperaConGPS(1500);
      ok = intentarPostHTTP(json, httpCode, detalle);
      if (!ok && (httpCode == 713 || httpCode == 714 || httpCode == 715 || httpCode == -1)) {
        if (!modemOk || enviarAT("AT", 800).indexOf("OK") == -1) {
          modemOk = false;
          iniciarModem4G();
          if (modemOk && asegurarPDPActivo()) {
            ok = intentarPostHTTP(json, httpCode, detalle);
          }
        } else if (renovarSesion4G()) {
          esperaConGPS(1500);
          ok = intentarPostHTTP(json, httpCode, detalle);
        }
      }
    }
  }

  if (ok) {
    nubeStatus = "✅ Sincronizado en Supabase (" + String(httpCode) + " OK)";
    Serial.printf("[4G SUPABASE] ¡ÉXITO! Coordenadas registradas en Supabase (HTTP %d).\n", httpCode);
    return true;
  }

  nubeStatus = "⚠️ Error 4G: " + detalle;
  Serial.printf("[4G SUPABASE] Fallo HTTP: %s\n", detalle.c_str());
  return false;
}

// ============================================================================
//  7. MANEJADORES DEL SERVIDOR WEB LOCAL (Wi-Fi AP 192.168.4.1)
// ============================================================================
void handleRoot() {
  server.send_P(200, "text/html", INDEX_HTML);
}

void handleData() {
  leerBateria();
  bool fijado = gps.location.isValid();
  double lat = fijado ? gps.location.lat() : 0.0;
  double lon = fijado ? gps.location.lng() : 0.0;
  double vel = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
  double alt = gps.altitude.isValid() ? gps.altitude.meters() : 0.0;
  uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;

  String out = "{";
  out += "\"fijado\":" + String(fijado ? "true" : "false") + ",";
  out += "\"lat\":" + String(lat, 6) + ",";
  out += "\"lon\":" + String(lon, 6) + ",";
  out += "\"velocidad\":" + String(vel, 1) + ",";
  out += "\"altitud\":" + String(alt, 1) + ",";
  out += "\"satelites\":" + String(sats) + ",";
  out += "\"bytes_nmea\":" + String(bytesNMEA) + ",";
  out += "\"bateria_pct\":" + String(bateriaPct) + ",";
  out += "\"bateria_v\":" + String(bateriaV, 2) + ",";
  out += "\"senal_4g\":\"" + escaparJSON(senal4G) + "\",";
  out += "\"nube_status\":\"" + escaparJSON(nubeStatus) + "\",";
  out += "\"maps_url\":\"https://maps.google.com/?q=" + String(lat, 6) + "," + String(lon, 6) + "\"";
  out += "}";

  server.send(200, "application/json", out);
}

void handleForzar() {
  leerBateria();
  bool fijado = gps.location.isValid();
  double lat = fijado ? gps.location.lat() : FALLBACK_LAT;
  double lon = fijado ? gps.location.lng() : FALLBACK_LON;
  double vel = (fijado && gps.speed.isValid()) ? gps.speed.kmph() : 0.0;
  uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;

  bool ok = enviarASupabase(lat, lon, bateriaPct, bateriaV, vel, sats);
  String out = "{\"ok\":" + String(ok ? "true" : "false") +
               ",\"status\":\"" + escaparJSON(nubeStatus) + "\"}";
  server.send(200, "application/json", out);
}

// ============================================================================
//  8. SETUP Y LOOP PRINCIPAL
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==================================================");
  Serial.println("   BRAXRECICLA IOT - MODO NUBE 4G ENTEL           ");
  Serial.println("==================================================");

  // ADC para batería
  pinMode(PIN_BAT_ADC, INPUT);
  analogSetAttenuation(ADC_11db);

  // Encendido de riel de energía principal y periférico
  pinMode(PIN_BOARD_POWER, OUTPUT);
  digitalWrite(PIN_BOARD_POWER, HIGH);
  delay(100);

  pinMode(PIN_PERIPH_POWER, OUTPUT);
  digitalWrite(PIN_PERIPH_POWER, HIGH);

  // Iniciar UART GPS (Quectel L76K) y Módem (SIMCom A7670G)
  Serial1.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial2.begin(MODEM_BAUD, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);

  // Conectar módem 4G a Entel
  iniciarModem4G();

  // Iniciar Wi-Fi AP local para monitoreo rápido
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASS, 1, 0, 4);

  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.on("/forzar", handleForzar);
  server.begin();

  leerBateria();
  Serial.printf("[BATERIA] Nivel: %d%% (%.2f V)\n", bateriaPct, bateriaV);
  Serial.printf("[WIFI] Red: %s | Panel: http://192.168.4.1\n", WIFI_AP_SSID);
  Serial.println("[USB] Comandos en Monitor Serie: 'forzar' (prueba 4G) | 'estado'");
  Serial.println("==================================================");

  ultimoEnvioMs = millis();
  ultimoLogMs = millis();
}

void procesarComandosSerial() {
  if (!Serial.available()) return;

  String raw = Serial.readStringUntil('\n');
  raw.trim();
  if (raw.length() == 0) return;

  String cmd = raw;
  cmd.toLowerCase();

  if (cmd.startsWith("at ")) {
    String atCmd = raw.substring(3);
    atCmd.trim();
    if (atCmd.length() > 0) {
      enviarAT(atCmd, 5000);
    }
    return;
  }

  if (cmd == "forzar" || cmd == "test") {
    leerBateria();
    bool fijado = gps.location.isValid();
    double lat = fijado ? gps.location.lat() : FALLBACK_LAT;
    double lon = fijado ? gps.location.lng() : FALLBACK_LON;
    double vel = (fijado && gps.speed.isValid()) ? gps.speed.kmph() : 0.0;
    uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
    Serial.printf("[USB] Ejecutando envío manual (%s: %.6f, %.6f | Bat: %d%% %.2fV | Vel: %.1f km/h | Sats: %u)...\n",
                  fijado ? "GPS real" : "FALLBACK", lat, lon, bateriaPct, bateriaV, vel, sats);
    enviarASupabase(lat, lon, bateriaPct, bateriaV, vel, sats);
  } else if (cmd == "estado" || cmd == "status") {
    leerBateria();
    actualizarSenal4G();
    uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
    Serial.printf("[ESTADO] Batería: %d%% (%.2f V) | Señal: %s | GPS fijado: %s | Sats: %u | NMEA: %lu B | Nube: %s\n",
                  bateriaPct, bateriaV, senal4G.c_str(),
                  gps.location.isValid() ? "SI" : "NO",
                  sats, bytesNMEA, nubeStatus.c_str());
  } else if (cmd == "diag") {
    Serial.println("[DIAG] === Estado Red 4G & PDP ===");
    enviarAT("AT+COPS?", 1500);
    enviarAT("AT+CPSI?", 1500);
    enviarAT("AT+CSQ", 1000);
    enviarAT("AT+CGDCONT?", 1500);
    enviarAT("AT+CGCONTRDP=1", 1500);
    Serial.println("[DIAG] FIN");
  } else {
    Serial.println("[USB] Comando no reconocido. Usa: 'forzar', 'estado', 'diag' o 'at <CMD>'");
  }
}

void loop() {
  server.handleClient();
  bombearGPS();
  procesarComandosSerial();

  uint32_t ahora = millis();

  // Envío automático cada 15 segundos cuando hay posición GPS válida
  if (ahora - ultimoEnvioMs > INTERVALO_ENVIO_MS) {
    ultimoEnvioMs = ahora;
    leerBateria();

    if (gps.location.isValid()) {
      double vel = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
      uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
      enviarASupabase(gps.location.lat(), gps.location.lng(), bateriaPct, bateriaV, vel, sats);
    } else {
      uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
      Serial.printf("[ESPERA] GPS triangulando (%u satélites | NMEA %lu B). Esperando coordenadas...\n",
                    sats, bytesNMEA);
    }
  }

  // Log periódico cada 3 segundos cuando hay fix satelital
  if (ahora - ultimoLogMs > INTERVALO_LOG_MS) {
    ultimoLogMs = ahora;
    if (gps.location.isValid()) {
      uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
      double vel = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
      Serial.printf("📍 [GPS] Sats: %u | Lat: %.6f | Lon: %.6f | Vel: %.1f km/h | 4G: %s\n",
                    sats, gps.location.lat(), gps.location.lng(), vel, senal4G.c_str());
    }
  }
}
