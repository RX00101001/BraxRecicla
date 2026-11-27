<?php
/**
 * BraxRecicla SpA - Servicio de Notificaciones por Correo Electrónico
 * Compatible con cPanel / Apache / PHP mail()
 */

header('Content-Type: application/json; charset=utf-8');

// Control de orÃ­genes permitidos (CORS restringido para prevenir abuso externo)
$allowedOrigins = [
    'https://braxrecicla.cl',
    'https://www.braxrecicla.cl',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001'
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header('Access-Control-Allow-Origin: https://braxrecicla.cl');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// =========================================================================
// CONTROL DE RATE LIMITING POR IP (Anti-Spam / Anti-DDoS de Capa de Aplicación)
// Limita a un máximo de 5 envíos de correo por IP cada 5 minutos
// =========================================================================
$clientIp = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$ipHash = md5($clientIp);
$rateLimitDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'brax_ratelimit';
if (!is_dir($rateLimitDir)) {
    @mkdir($rateLimitDir, 0700, true);
}
$rateFile = $rateLimitDir . DIRECTORY_SEPARATOR . 'rl_' . $ipHash . '.json';
$now = time();
$windowSeconds = 300; // Ventana de 5 minutos
$maxRequests = 5;     // Máximo 5 solicitudes por ventana

$rateData = ['count' => 0, 'first_request' => $now];
if (file_exists($rateFile)) {
    $content = @file_get_contents($rateFile);
    if ($content) {
        $decoded = json_decode($content, true);
        if ($decoded && isset($decoded['first_request']) && ($now - $decoded['first_request']) < $windowSeconds) {
            $rateData = $decoded;
        }
    }
}

if ($rateData['count'] >= $maxRequests) {
    http_response_code(429);
    echo json_encode([
        'ok' => false,
        'error' => 'Demasiadas solicitudes enviadas. Por favor espera 5 minutos antes de volver a contactar.',
        'retry_after' => $windowSeconds - ($now - $rateData['first_request'])
    ]);
    exit;
}

$rateData['count']++;
@file_put_contents($rateFile, json_encode($rateData));

$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);

// 1. VerificaciÃ³n de carga y trampa anti-spam (Honeypot)
if (!$input || !empty($input['_hp']) || !empty($input['website'])) {
    http_response_code(200);
    echo json_encode(['ok' => false, 'error' => 'Solicitud invÃ¡lida o descartada']);
    exit;
}

// 2. SanitizaciÃ³n estricta y prevenciÃ³n de CRLF Injection (Email Header Injection)
$tipo = preg_replace('/[\r\n]+/', '', htmlspecialchars($input['tipo'] ?? 'B2B', ENT_QUOTES, 'UTF-8'));
$ticket = preg_replace('/[\r\n]+/', '', htmlspecialchars($input['ticket'] ?? ('BRX-' . strtoupper(substr(uniqid(), -6))), ENT_QUOTES, 'UTF-8'));
$nombre = preg_replace('/[\r\n]+/', '', htmlspecialchars($input['empresa'] ?? $input['nombre'] ?? 'Cliente', ENT_QUOTES, 'UTF-8'));
$rut = preg_replace('/[\r\n]+/', '', htmlspecialchars($input['rut'] ?? 'S/R', ENT_QUOTES, 'UTF-8'));
$emailCliente = filter_var($input['email'] ?? '', FILTER_VALIDATE_EMAIL);
$material = htmlspecialchars($input['material'] ?? 'Residuos Declarados', ENT_QUOTES, 'UTF-8');
$volumen = htmlspecialchars($input['volumen'] ?? '1', ENT_QUOTES, 'UTF-8');
$direccion = htmlspecialchars($input['direccion'] ?? 'RegiÃ³n Metropolitana', ENT_QUOTES, 'UTF-8');
$fecha = date('d-m-Y H:i:s');

// =========================================================================
// 1. CORREO A BRAXRECICLA (Alerta Operativa para Flota y Administración)
// =========================================================================
$toAdmin = "contacto@braxrecicla.cl";
$subjectAdmin = "=?UTF-8?B?" . base64_encode("🔔 Nueva Solicitud $tipo [$ticket] - $nombre") . "?=";

$bodyAdmin = "
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background-color: #030712; color: #f8fafc; padding: 20px; }
    .card { background-color: #0f172a; border: 1px solid #10b981; border-radius: 12px; padding: 24px; max-width: 600px; margin: auto; }
    .badge { background: #10b981; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 20px; font-size: 12px; display: inline-block; }
    h2 { color: #34d399; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    td { padding: 8px 4px; border-bottom: 1px solid #1e293b; color: #cbd5e1; font-size: 14px; }
    td.label { color: #94a3b8; font-weight: bold; width: 40%; }
    .footer { margin-top: 20px; font-size: 11px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class='card'>
    <span class='badge'>NUEVA SOLICITUD $tipo</span>
    <h2>BraxRecicla · Alerta Logística</h2>
    <p style='color: #94a3b8; font-size: 13px;'>Se ha ingresado una nueva solicitud de retiro desde la web oficial:</p>
    <table>
      <tr><td class='label'>Ticket Folio:</td><td><strong>$ticket</strong></td></tr>
      <tr><td class='label'>Cliente / Razón Social:</td><td><strong>$nombre</strong></td></tr>
      <tr><td class='label'>RUT:</td><td>$rut</td></tr>
      <tr><td class='label'>Correo de Contacto:</td><td>" . ($emailCliente ?: 'No ingresado') . "</td></tr>
      <tr><td class='label'>Material a Retirar:</td><td>$material</td></tr>
      <tr><td class='label'>Volumen / Estimación:</td><td>$volumen</td></tr>
      <tr><td class='label'>Dirección / Comuna:</td><td>$direccion</td></tr>
      <tr><td class='label'>Fecha de Ingreso:</td><td>$fecha</td></tr>
    </table>
    <div style='margin-top: 20px; text-align: center;'>
      <a href='https://braxrecicla.cl/panel' style='background: #10b981; color: #000; font-weight: bold; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px;'>Ver en BraxPanel</a>
    </div>
    <div class='footer'>
      Sistema Automatizado BraxRecicla SpA · Santiago de Chile
    </div>
  </div>
</body>
</html>
";

$headersAdmin = "MIME-Version: 1.0\r\n";
$headersAdmin .= "Content-type: text/html; charset=UTF-8\r\n";
$headersAdmin .= "From: BraxRecicla Web <contacto@braxrecicla.cl>\r\n";
if ($emailCliente) {
    $headersAdmin .= "Reply-To: $emailCliente\r\n";
}
$headersAdmin .= "X-Mailer: PHP/" . phpversion();

@mail($toAdmin, $subjectAdmin, $bodyAdmin, $headersAdmin);

// =========================================================================
// 2. CORREO AL CLIENTE (Comprobante Formal de Ingreso)
// =========================================================================
if ($emailCliente) {
    $subjectCliente = "=?UTF-8?B?" . base64_encode("Comprobante de Solicitud de Retiro [$ticket] · BraxRecicla") . "?=";
    
    $bodyCliente = "
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; background-color: #f8fafc; color: #0f172a; padding: 20px; }
        .box { background-color: #ffffff; border: 1px solid #e2e8f0; border-top: 6px solid #10b981; border-radius: 12px; padding: 30px; max-width: 600px; margin: auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 24px; }
        .title { color: #065f46; font-size: 20px; font-weight: 800; margin: 4px 0; }
        .subtitle { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
        .ticket-box { background: #f0fdf4; border: 1px dashed #10b981; border-radius: 8px; padding: 14px; text-align: center; margin: 20px 0; }
        .ticket-number { font-size: 18px; font-weight: bold; color: #047857; font-family: monospace; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        td { padding: 9px 4px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #334155; }
        td.label { color: #64748b; font-weight: 600; width: 40%; }
        .steps { background: #f8fafc; border-radius: 8px; padding: 15px; margin-top: 20px; font-size: 12px; color: #475569; }
        .steps ol { margin: 8px 0 0 18px; padding: 0; }
        .steps li { margin-bottom: 6px; }
        .footer { margin-top: 25px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
      </style>
    </head>
    <body>
      <div class='box'>
        <div class='header'>
          <div class='subtitle'>Economía Circular & Trazabilidad Oficial</div>
          <div class='title'>BraxRecicla SpA</div>
        </div>

        <p style='font-size: 14px;'>Hola <strong>$nombre</strong>,</p>
        <p style='font-size: 13px; color: #475569; line-height: 1.5;'>
          Hemos recibido exitosamente tu requerimiento de reciclaje en nuestra plataforma oficial. Tu retiro ha quedado registrado para coordinación logística.
        </p>

        <div class='ticket-box'>
          <div style='font-size: 11px; color: #065f46; font-weight: 600; text-transform: uppercase;'>N° de Ticket Oficial</div>
          <div class='ticket-number'>$ticket</div>
        </div>

        <table>
          <tr><td class='label'>Material Solicitado:</td><td><strong>$material</strong></td></tr>
          <tr><td class='label'>Volumen / Kilos:</td><td>$volumen</td></tr>
          <tr><td class='label'>RUT Registrado:</td><td>$rut</td></tr>
          <tr><td class='label'>Dirección / Comuna:</td><td>$direccion</td></tr>
          <tr><td class='label'>Fecha y Hora:</td><td>$fecha</td></tr>
        </table>

        <div class='steps'>
          <strong>Próximos Pasos del Servicio:</strong>
          <ol>
            <li>Nuestro equipo de flota revisará tu zona geográfica para asignarte un camión recolector.</li>
            <li>El camión realizará el pesaje en terreno y se emitirá el respaldo con <strong>Sello Criptográfico SHA-256</strong> bajo la <strong>Ley REP N° 20.920</strong>.</li>
            <li>Para cualquier duda, puedes responder directamente a este correo o escribir a <strong>contacto@braxrecicla.cl</strong>.</li>
          </ol>
        </div>

        <div class='footer'>
          © " . date('Y') . " BraxRecicla SpA · Resolución Sanitaria SEREMI RM N° 12481<br>
          Santiago, Chile · <a href='https://braxrecicla.cl' style='color: #10b981; text-decoration: none;'>www.braxrecicla.cl</a>
        </div>
      </div>
    </body>
    </html>
    ";

    $headersCliente = "MIME-Version: 1.0\r\n";
    $headersCliente .= "Content-type: text/html; charset=UTF-8\r\n";
    $headersCliente .= "From: BraxRecicla SpA <contacto@braxrecicla.cl>\r\n";
    $headersCliente .= "Reply-To: contacto@braxrecicla.cl\r\n";
    $headersCliente .= "X-Mailer: PHP/" . phpversion();

    @mail($emailCliente, $subjectCliente, $bodyCliente, $headersCliente);
}

echo json_encode([
    'ok' => true,
    'ticket' => $ticket,
    'notified_admin' => true,
    'notified_client' => (bool)$emailCliente
]);
