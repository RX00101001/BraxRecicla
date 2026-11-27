-- Solo lectura. Compatible antes y después de agregar la columna codigo.
-- El índice compara sin espacios exteriores y sin distinguir mayúsculas.
WITH rutas AS (
 SELECT r.id,r.nombre,r.fecha,r.estado,
        coalesce(to_jsonb(r)->>'codigo',r.nombre) AS codigo
 FROM public.flota_rutas r
), duplicados AS (
 SELECT lower(btrim(codigo)) AS normalizado
 FROM rutas GROUP BY lower(btrim(codigo)) HAVING count(*)>1
)
SELECT r.* FROM rutas r JOIN duplicados d
 ON lower(btrim(r.codigo))=d.normalizado
ORDER BY d.normalizado,r.fecha,r.id;

-- Antes de la migración: elegir explícitamente un UUID del resultado y
-- cambiar su nombre por un código único. No ejecutar con valores de ejemplo.
-- UPDATE public.flota_rutas SET nombre='CODIGO_UNICO_ELEGIDO'
-- WHERE id='UUID_DE_LA_RUTA';
-- Si codigo ya existe y tiene un valor, actualizar codigo y nombre juntos.
-- Luego repetir la consulta de diagnóstico y la migración completa.
