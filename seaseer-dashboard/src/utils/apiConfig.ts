export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (!envUrl || envUrl.trim() === '') {
    throw new Error('VITE_API_URL environment variable is required but not set.');
  }

  const cleaned = envUrl.trim().replace(/^["'“”]+|["'“”]+$/g, '');
  return cleaned.replace(/\/+$/, '');
}

export function getTusEndpoint(): string {
  const envUrl = import.meta.env.VITE_TUS_URL;
  if (!envUrl || envUrl.trim() === '') {
    throw new Error('VITE_TUS_URL environment variable is required but not set.');
  }

  const cleaned = envUrl.trim().replace(/^["'“”]+|["'“”]+$/g, '');
  return cleaned.replace(/\/+$/, '') + '/';
}
