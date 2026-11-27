import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/mockDatabase';
import crypto from 'crypto';

// Habilitar CORS para que la Web (3001) pueda llamar a esta API
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // En producción debería ser http://localhost:3001 o el dominio real
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  try {
    const db = readDb();
    return NextResponse.json(db, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json({ error: 'Error leyendo la base de datos' }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const db = readDb();
    
    const newId = `req-${crypto.randomUUID()}`;
    const newRecord = { ...body, id: newId, fecha: new Date().toISOString(), estado: 'Pendiente' };

    if (body.tipo === 'b2c') {
      db.b2c.unshift(newRecord); // Agregar al inicio
    } else if (body.tipo === 'b2b') {
      db.b2b.unshift(newRecord);
    } else {
      return NextResponse.json({ error: 'Tipo inválido' }, { status: 400, headers: corsHeaders });
    }

    writeDb(db);
    return NextResponse.json({ success: true, record: newRecord }, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json({ error: 'Error guardando solicitud' }, { status: 500, headers: corsHeaders });
  }
}
