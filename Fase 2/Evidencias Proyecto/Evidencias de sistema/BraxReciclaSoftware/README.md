This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


## Despacho de escritorio de BraxRecicla

La vista `/rutas/` usa datos de Supabase y reúne rutas, paradas, retiros asignados,
mapa Leaflet y solicitudes sin asignar en paneles redimensionables. El arrastre de
solicitudes y el cambio de orden llaman a las RPC de planificación: no se guardan
como borradores del navegador. Tras aplicar las migraciones de planificación avanzada, los operadores autorizados
con MFA pueden planificar rutas sin iniciar. La administración de catálogos continúa
reservada al administrador/dueño. Todas las comprobaciones se repiten en PostgreSQL.

### Habilitar las funciones nuevas

En SQL Editor del proyecto del ERP, ejecutar **completo**
`../Database/migrations/20261120_despacho_escritorio.sql`, después de las migraciones
`20261113_planificacion_flota.sql`, `20261119_brax_driver.sql` y
`20261120_brax_driver_acceso.sql`. No volver a ejecutar las migraciones anteriores
si el proyecto ya las tiene. La migración nueva es transaccional y se puede repetir.

Agrega campos opcionales de dirección/comuna/prioridad, el indicador de borrador,
un catálogo mínimo de conductores y RPC de despacho. Mantiene autorización, MFA,
RLS y auditoría. La eliminación de un borrador es una cancelación lógica: libera
las paradas y conserva los registros. Driver no recibe borradores hasta programarlos.

Por decisión del usuario, esta migración **no se aplicó a la base remota durante
la implementación**. Antes de aplicarla, la interfaz permite las operaciones
anteriores de planificación mediante `flota_plan_mutar`, y asignar conductor por
UUID con `brax_driver_asignar`. Señala las funciones pendientes de habilitación.
El catálogo por nombre, la creación de borradores y la edición de datos de retiro
requieren la migración nueva. El camión se selecciona de `flota_camiones`.

### Mapa y ubicación en vivo

- Teléfono: `flota_gps_conductor`, vinculado a ruta y conductor actual.
- ESP32: `telemetria_flota`, vinculado a la patente del camión, solo registros con
  `fuente_ubicacion = 'gps'`. Los puntos de fuente desconocida no se presentan como GPS.
- La interfaz normaliza cada fuente como `source: 'phone' | 'esp32'`, coordenadas,
  timestamp y estado online derivado. No sobrescribe una fuente con la otra.
- Se considera en línea una posición de los últimos 120 segundos de una ruta
  activa. Las posiciones anteriores se muestran como última ubicación conocida.
- Realtime actualiza las tablas y el mapa; hay sondeo de respaldo cada 30 segundos.
- Las coordenadas de las paradas se reutilizan de `flota_ubicaciones`. No hay
  geocodificación automática. Los datos faltantes aparecen como tales.
- La polilínea y la distancia son geométricas, entre coordenadas conocidas. No hay
  optimización, ETA ni cálculo por calles. El fondo cartográfico requiere Internet
  y conserva las atribuciones OpenStreetMap/CARTO.

Las evidencias (fotos privadas con enlace temporal, firma y kilos declarados)
siguen accesibles desde la nueva vista y desde `/rutas/driver/`. Los borradores
locales anteriores se conservan en `/rutas/local/`; no se envían a Driver.

### Comprobaciones

```powershell
npm ci
npm test
npx tsc --noEmit
npm run build
```

Las pruebas SQL usan PostgreSQL aislado con PGlite y fixtures de QA. Verifican
persistencia, permisos, reversión atómica, versiones, duplicados, orden y contrato
con Driver sin escribir en el proyecto remoto.

Para las pruebas de navegador, instalar Playwright de forma temporal:

```powershell
npm install --prefix tmp/browser-check playwright --ignore-scripts --no-save --no-package-lock
python -m http.server 3100 --bind 127.0.0.1 --directory out
# En otra terminal, desde esta carpeta:
node tests/erp-navigation.cjs
node tests/dispatch-browser.cjs
```

El runner usa Edge en Windows, un `.env.local` con la URL del proyecto (solo para
interceptar el host) y datos de PostgreSQL aislado. Intercepta todas las peticiones
a Supabase: las pruebas no modifican datos reales. El despliegue y una prueba
operativa con cuenta administradora/conductor reales quedan para después de
aplicar la migración.


### Clave del mapa CARTO Dark Matter

Configurar `NEXT_PUBLIC_CARTO_API_KEY` en `BraxReciclaSoftware/.env.local`, junto a
`package.json` (no dentro de `src/` ni en el proyecto Driver):

```dotenv
NEXT_PUBLIC_CARTO_API_KEY=
```

Completar el valor localmente con una clave de CARTO Basemaps. La URL usada es
`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=…`, según
[la documentación de CARTO](https://www.carto.com/basemaps/). Mantiene Dark Matter
y las atribuciones de OpenStreetMap contributors y CARTO.

Después de cambiar la variable, reiniciar `npm run dev`. Para producción, definir
la variable en el entorno de compilación y ejecutar nuevamente `npm run build`
antes de desplegar: Next.js incorpora las variables públicas al compilar.
`.env.local` está excluido de Git. Esta clave se utiliza en el navegador; no usar
una clave secreta de administración ni una clave de Supabase en ese campo.

Sin clave no se descargan teselas: aparece un aviso sobre el fondo oscuro y se
conservan los marcadores, la polilínea y la selección de rutas. Una clave inválida
o restringida debe corregirse en la configuración de CARTO. La verificación visual
de Santiago con teselas reales requiere una clave válida; no se sustituye por
datos ni imágenes simuladas.


## Planificación avanzada y solicitudes en el mapa (20 de noviembre de 2026)

### Diagnóstico y proveedor

La revisión de solo lectura encontró 11 solicitudes B2B sin dirección, 18 B2C
(16 con dirección, solo una con comuna separada) y ninguna fila de
`flota_ubicaciones`. No existía un proveedor de geocodificación configurado.
Los marcadores necesitaban coordenadas reales; no era solo un problema de Leaflet.
Parte de las direcciones de la web incluye un sufijo de contacto que ahora se
elimina de la consulta geográfica, sin cambiar el formulario público.

Se preparó **OpenCage** por elección del usuario, con la clave por configurar.
Permite conservar resultados y usarlos en otros mapas:
[condiciones y precios](https://opencagedata.com/pricing),
[API y precisión](https://opencagedata.com/api). La prueba gratuita permite 2.500
consultas/día, una por segundo, **solo para evaluación**; producción necesita un
plan adecuado. No se contrató un plan ni se usaron direcciones reales para probar
el proveedor. CARTO se conserva como fondo; no es el geocodificador de este flujo.

No se añade una comuna ni Región Metropolitana por defecto. Se restringe el país
al contexto Chile y solo se confirma automáticamente un resultado de dirección
precisa con calle, número, comuna explícita y país coincidentes. Una calle o centro
comunal sin número, un resultado ambiguo o una dirección sin contexto quedan para
revisión. La confianza del proveedor por sí sola no se toma como prueba de exactitud.

### Despliegue necesario

Conservar el orden de las migraciones anteriores (planificación, acceso Driver,
despacho de escritorio y jornada móvil). Aplicar después:

1. `Database/migrations/20261120_erp_geocodificacion.sql`.
2. `Database/migrations/20261120_erp_planificacion.sql`.

Son transaccionales y repetibles. No se aplicaron a la base remota durante esta
implementación. No repetir después migraciones viejas que sustituyan las mismas RPC.
Si hay códigos históricos duplicados, el índice único abortará la segunda
migración: revisar esos duplicados antes de decidir su corrección. No se renombran
rutas existentes automáticamente.

Desplegar la Edge Function desde la raíz del repositorio, usando el proyecto correcto:

```powershell
npx supabase functions deploy geocode-pickups --project-ref TU_PROJECT_REF
```

Configurar en **Supabase → Edge Functions → Secrets**, sin ponerlas en el frontend:

- `OPENCAGE_API_KEY`: clave privada del proveedor.
- `GEOCODING_DAILY_LIMIT`: opcional; 1.000 por defecto, máximo 2.500 consultas/día UTC.
- `GEOCODING_ALLOWED_ORIGINS`: orígenes permitidos del ERP separados por coma.

Supabase provee las variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` a la función. Ninguna clave privada lleva prefijo
`NEXT_PUBLIC_`. La clave CARTO de `BraxReciclaSoftware/.env.local` sigue siendo
independiente y solo sirve para teselas.

Para solicitudes nuevas automáticas, habilitar `pg_cron`, `pg_net` y Vault en el
proyecto, crear en Vault `brax_geo_project_url` y `brax_geo_service_role_jwt`
(JWT service_role del mismo proyecto, solo backend), y ejecutar
`Database/setup/geocoding_worker.sql`. No copiar secretos reales a ese archivo.
El programador invoca la función autenticada cada minuto. Se conserva
`verify_jwt=true`; no se desactiva la autenticación de las funciones.
[Programación de funciones en Supabase](https://supabase.com/docs/guides/functions/schedule-functions).

Después, recompilar/desplegar el ERP. No se necesita modificar la web pública ni
geocodificar en el teléfono. Sin clave/función/cron configurados, la aplicación
muestra el pendiente de configuración; no simula resultados.

### Operación y seguridad

- Cada solicitud nueva en B2B/B2C se encola mediante trigger. Cambios reales de
  dirección invalidan una ubicación automática; una ubicación manual queda
  protegida y pide revisión si cambia la dirección. Cambiar solo el sufijo de
  contacto no invalida la ubicación.
- La cola se procesa en lotes de hasta cinco, con un lease global, separación de
  al menos 1,1 segundos entre consultas externas, límite diario, caché de direcciones
  y hasta tres intentos con espera. Una clave rechazada no se reintenta sin control.
  El botón administrativo puede volver a encolar errores después de cinco minutos.
- **Geocodificar solicitudes pendientes** encola hasta 50 registros antiguos y
  procesa hasta cinco por pulsación. Los demás continúan por cron. No hay barrido
  al abrir el ERP. Se muestran procesadas/resueltas/revisión/errores/omitidas;
  las ambiguas, no encontradas y sin dirección se identifican para corrección.
- **Ver solicitud** permite corregir dirección/comuna/región y seleccionar un
  punto o arrastrarlo. Se exige confirmar explícitamente que es la ubicación del
  retiro antes de guardar coordenadas como manuales. No se aceptan nulos ni 0,0.
  Las coordenadas confirmadas se reutilizan de `flota_ubicaciones`, también en Driver.
- Tabla y mapa usan la misma colección filtrada de solicitudes sin asignar. Fecha,
  estado de solicitud, comuna y búsqueda filtran ese conjunto; conductor/camión y
  estado de ruta filtran las rutas y su seguimiento (una solicitud sin asignar no
  tiene conductor ni camión todavía). **Mostrar todas las solicitudes** ajusta los
  puntos válidos de ese conjunto sin descartar los filtros.
- Los marcadores distinguen solicitudes naranjas, paradas verdes, Driver azul y
  ESP32 morado. Las solicitudes se agrupan al alejarse; sus ventanas muestran datos
  y permiten abrir/asignar. Las actualizaciones GPS no vuelven a centrar un mapa
  que el usuario está explorando.
- Administradores y operadores ERP autorizados con MFA pueden crear, asignar,
  corregir ubicaciones, ordenar y eliminar rutas vacías sin iniciar. Los operadores
  no administran conductores/camiones ni ejecutan jornadas o cambios de báscula.
  El inicio/cierre normal sigue en Driver. Administradores conservan la corrección
  de planificación prevista por las RPC anteriores.
- El número de ruta es el único código visible. Una secuencia PostgreSQL propone
  números persistentes y editables, con unicidad sin distinguir mayúsculas. UUID
  permanece interno. Abrir/cancelar formularios puede consumir números: no se reutilizan.
  Los códigos numéricos personalizados adelantan la secuencia cuando corresponde.
- Los datos adicionales del conductor se vinculan al usuario Auth existente.
  Nombre se conserva en `erp_profiles`, correo procede de Auth y se modifica en su
  administración existente. No se crean contraseñas ni usuarios duplicados. Inactivo
  bloquea nuevas asignaciones; no desconecta automáticamente una jornada ya activa.
- La asociación predeterminada conductor/camión es consistente en ambos sentidos.
  Cambiar el camión de una ruta no cambia ese valor predeterminado. Se advierte si
  el camión está activo y se rechaza un conflicto activo en la misma fecha.
- **Eliminar ruta vacía** requiere confirmación y comprobación backend: sin inicio,
  ninguna parada ni siquiera histórica, sin GPS/evidencias ni eventos operativos.
  Se realiza baja lógica, conserva auditoría y reserva el código, y no borra retiros.

### Validación real después del despliegue

1. Crear una ruta con administrador: verificar consecutivo propuesto, editarlo y
   guardar. Abrir otro formulario para comprobar que no se repite.
2. Configurar un conductor existente y su camión predeterminado. Seleccionarlo en
   una ruta, comprobar autoselección y cambiar el camión solo para esa ruta.
3. Repetir con un operador con MFA: debe poder planificar, pero no guardar catálogos
   ni iniciar/cerrar jornadas. Intentar un código duplicado debe fallar en Supabase.
4. Crear una ruta vacía y eliminarla. Intentarlo con una que tuvo paradas, GPS o
   inicio debe ser rechazado. Verificar que su código no se reutiliza.
5. Enviar una solicitud real desde la web con calle/número/comuna. Verificar la cola,
   la función y la ubicación guardada. Un dato insuficiente debe pedir revisión,
   nunca producir un centro comunal como dirección exacta.
6. Ejecutar el lote administrativo para antiguas. Corregir una dirección sin datos,
   elegir un punto y confirmarlo. Revisar que no se reemplacen ubicaciones manuales.
7. Filtrar y seleccionar filas/marcadores, abrir sus ventanas y asignar por arrastre.
   En Driver, verificar esa ruta, el camión, el orden y las mismas coordenadas.
   Iniciar/finalizar desde iPhone y comprobar Realtime y las dos fuentes GPS del ERP.

`npm test` incluye pruebas SQL de secuencia, permisos, baja segura, cola/caché/cuota,
protección manual y reintentos, y pruebas del validador OpenCage sin llamadas reales.
El runner `node tests/dispatch-browser.cjs` usa PostgreSQL aislado para verificar la
interfaz y las RPC sin modificar Supabase remoto. El control de tipos del worker es
`deno check supabase/functions/geocode-pickups/index.ts` desde la raíz del repositorio.
