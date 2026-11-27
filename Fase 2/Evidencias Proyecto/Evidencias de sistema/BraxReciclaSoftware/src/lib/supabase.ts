import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// SEGURIDAD INDUSTRIAL (CWE-613 / OWASP A07):
// Usar sessionStorage para asegurar que la sesión activa y el nivel MFA (AAL2)
// se destruyan automáticamente al cerrar la pestaña o el navegador.
const getSessionStorage = () => {
  if (typeof window !== 'undefined') {
    try {
      // Limpiar tokens huérfanos de localStorage de versiones anteriores
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
          localStorage.removeItem(key);
        }
      });
    } catch {}
    return window.sessionStorage;
  }
  return undefined;
};

function createErpClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: getSessionStorage(),
    },
  });
}

// Singleton: evitar múltiples instancias en el mismo contexto de browser
const globalForSupabase = globalThis as unknown as { supabase?: ReturnType<typeof createErpClient> };
export const supabase = globalForSupabase.supabase ?? createErpClient();

if (process.env.NODE_ENV !== 'production') {
  globalForSupabase.supabase = supabase;
}
