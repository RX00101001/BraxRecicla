import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type ErpRole = 'admin' | 'dueno' | 'operador' | 'chofer';

export async function getErpRole(userId: string): Promise<ErpRole | null> {
  const { data, error } = await supabase.rpc('erp_role');
  let role: unknown = data;
  if (error) {
    if (error.code !== 'PGRST202' && error.code !== '42883') throw error;
    const legacy = await supabase.from('perfiles_usuarios').select('rol').eq('id', userId).maybeSingle();
    if (legacy.error) throw legacy.error;
    role = legacy.data?.rol;
  }
  role = typeof role === 'string' ? role.trim().toLowerCase() : role;
  if (role === 'administrador' || role === 'admin') return 'admin';
  if (role === 'dueno' || role === 'operador' || role === 'chofer') return role;
  return null;
}

export async function hasErpMfa(session: Session) {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(session.access_token);
  if (error) throw error;
  return data.currentLevel === 'aal2';
}

export async function getErpAccess() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session || !await hasErpMfa(session)) return null;
  const role = await getErpRole(session.user.id);
  if (!role) throw new Error('Tu cuenta no tiene un rol autorizado en el ERP.');
  return { user: session.user, role };
}

export const canManageDispatch = (role: ErpRole | null) => role === 'admin' || role === 'dueno' || role === 'operador';
