/**
 * Formateador oficial de peso chileno para BraxRecicla SpA (Opción 2: Coma decimal estricta).
 * Reglas de metrología industrial:
 * - El separador decimal es ESTRICTAMENTE la coma (,).
 * - El separador de miles es el punto (.).
 * - Si tiene decimales, se muestran hasta 3 decimales limpios (sin ceros residuales a la derecha).
 * 
 * Ejemplos:
 * 1.002   -> "1,002 kg" (1 kilo con 2 gramos)
 * 115.802 -> "115,802 kg" (115 kilos con 802 gramos)
 * 115.8   -> "115,8 kg"
 * 115     -> "115 kg"
 * 4164    -> "4.164 kg" (4 mil 164 kilos de camión)
 * 4164.5  -> "4.164,5 kg"
 */
export function formatPesoChileno(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '0 kg';
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  if (isNaN(num) || num === 0) return '0 kg';

  // Separar parte entera y parte decimal
  const parts = num.toString().split('.');
  const intStr = parts[0];
  const decStr = parts[1] || '';

  // Formato chileno de miles con punto (.)
  const intFormatted = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  if (decStr.length > 0) {
    const cleanDec = decStr.slice(0, 3).replace(/0+$/, '');
    if (cleanDec.length > 0) {
      return `${intFormatted},${cleanDec} kg`;
    }
  }

  return `${intFormatted} kg`;
}
