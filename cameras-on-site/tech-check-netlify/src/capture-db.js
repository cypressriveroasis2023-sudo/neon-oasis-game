const originalCreateClient = supabase.createClient.bind(supabase);
supabase.createClient = (...args) => {
  const client = originalCreateClient(...args);
  if (!window.__techCheckDb) window.__techCheckDb = client;
  return client;
};
