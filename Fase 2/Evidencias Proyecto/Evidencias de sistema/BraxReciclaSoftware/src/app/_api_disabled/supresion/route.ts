import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/mockDatabase';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const { id, tipo } = await request.json();
    
    if (!id || !tipo) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 });
    }

    const db = readDb();
    let found = false;

    if (tipo === 'b2c') {
      const index = db.b2c.findIndex((req: any) => req.id === id);
      if (index !== -1) {
        // Ejecutar Supresión Criptográfica (Ley 21.719)
        // Guardamos los datos operativos, pero destruimos la PII (Personally Identifiable Information)
        db.b2c[index].nombre = null;
        db.b2c[index].direccion = null;
        
        // Hashear el RUT de forma irreversible pero trazable
        const hash = crypto.createHash('sha256').update(db.b2c[index].rut).digest('hex').substring(0, 10);
        db.b2c[index].rut = `CIUDADANO_SUPRESION_LEGAL_21719_${hash}`;
        
        db.b2c[index].estado = 'Anonimizado (Ley 21.719)';
        found = true;
      }
    }

    if (!found) {
      return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });
    }

    writeDb(db);
    return NextResponse.json({ success: true, message: 'Supresión Criptográfica Ejecutada Exitosamente' });
  } catch (error) {
    return NextResponse.json({ error: 'Error ejecutando supresión' }, { status: 500 });
  }
}
