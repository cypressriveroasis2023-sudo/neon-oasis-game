const originalCreateClient = supabase.createClient.bind(supabase);

supabase.createClient = (url, key, options = {}) => {
  const client = originalCreateClient(url, key, {
    ...options,
    auth: {
      ...(options.auth || {}),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  if (!window.__techCheckDb) window.__techCheckDb = client;
  return client;
};
