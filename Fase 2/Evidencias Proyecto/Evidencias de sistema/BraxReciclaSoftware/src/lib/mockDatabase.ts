import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data.json');

// Inicializar el archivo si no existe
if (!fs.existsSync(dbPath)) {
  const initialData = {
    b2c: [
      {
        id: 'req-1',
        tipo: 'b2c',
        nombre: 'María González',
        rut: '15.234.567-8',
        direccion: 'Av. Providencia 1234, Santiago',
        material: 'Botellas de Bebida (PET 1)',
        kilosEstimados: 5,
        fecha: new Date().toISOString(),
        estado: 'Pendiente'
      }
    ],
    b2b: [
      {
        id: 'req-2',
        tipo: 'b2b',
        razonSocial: 'ACEROS BRAX S.A.',
        rut: '76.000.000-K',
        material: 'Chatarra Ferrosa',
        volumen: 50,
        fecha: new Date().toISOString(),
        estado: 'Aprobado'
      }
    ]
  };
  fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
}

export const readDb = () => {
  const data = fs.readFileSync(dbPath, 'utf8');
  return JSON.parse(data);
};

export const writeDb = (data: any) => {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
};
