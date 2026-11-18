/** The census runs only on the TCP project. SUPABASE_URL is read by the caller
 * and must match this host exactly. Any other Supabase project is refused. */
export const TCP_PROJECT_URL = 'https://tughscoxralhofrckvxy.supabase.co';

export function assertTcpProject(url: string | undefined): string {
  if (url !== TCP_PROJECT_URL) throw new Error('Backend unavailable');
  return url;
}
