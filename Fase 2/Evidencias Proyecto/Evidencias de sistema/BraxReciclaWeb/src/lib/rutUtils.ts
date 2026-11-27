export const validateRut = (rut: string) => {
  const cleanRut = rut.replace(/\./g, '');
  if (!/^[0-9]+-[0-9kK]{1}$/.test(cleanRut)) return false;
  
  const [rutBody, dv] = cleanRut.split('-');
  let suma = 0;
  let multiplicador = 2;
  
  for (let i = rutBody.length - 1; i >= 0; i--) {
    suma += multiplicador * parseInt(rutBody.charAt(i));
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  
  const expectedDv = 11 - (suma % 11);
  const dvChar = expectedDv === 11 ? '0' : expectedDv === 10 ? 'K' : expectedDv.toString();
  
  return dv.toUpperCase() === dvChar;
};

export const formatRut = (rut: string) => {
  let cleanRut = rut.replace(/[^0-9kK]/gi, '').toUpperCase();
  if (cleanRut.length <= 1) return cleanRut;
  
  const rutBody = cleanRut.slice(0, -1);
  const dv = cleanRut.slice(-1);
  
  let formattedBody = '';
  for (let i = rutBody.length - 1, j = 1; i >= 0; i--, j++) {
    formattedBody = rutBody.charAt(i) + formattedBody;
    if (j % 3 === 0 && i !== 0) {
      formattedBody = '.' + formattedBody;
    }
  }
  
  return `${formattedBody}-${dv}`;
};
