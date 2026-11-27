import { supabase } from './supabase';

export function watchErpChanges(
  topic: string,
  tables: readonly string[],
  refresh: () => void,
  setConnected: (connected: boolean) => void,
) {
  let active = true;
  // A channel may remain registered until Supabase acknowledges the unsubscribe.
  const channel = supabase.channel(`${topic}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`);
  const stop = () => {
    if (!active) return;
    active = false;
    void supabase.removeChannel(channel).catch(error => console.error('Error cerrando Realtime:', error));
  };
  setConnected(false);
  try {
    for (const table of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (active) refresh();
      });
    }
    channel.subscribe(status => {
      if (!active) return;
      setConnected(status === 'SUBSCRIBED');
      if (status === 'SUBSCRIBED') refresh();
    });
  } catch (error) {
    stop();
    console.error('Error iniciando Realtime:', error);
    setConnected(false);
  }
  return stop;
}
