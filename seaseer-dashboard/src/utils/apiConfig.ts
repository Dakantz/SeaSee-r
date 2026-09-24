/**
 * Utility to resolve API and TUSD endpoints dynamically.
 * 
 * If VITE_API_URL or VITE_TUS_URL is explicitly set (e.g., in .env or build args),
 * that value takes precedence.
 * Otherwise, the endpoints dynamically adapt to the current browser host,
 * targeting port 8000 for the backend and port 8080 for TUSD:
 *   - http://localhost:3000 -> queries http://localhost:8000
 *   - http://warhammer.ivc.tugraz.at:3000 -> queries http://warhammer.ivc.tugraz.at:8000
 */

export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:8000`;
  }

  return 'http://localhost:8000';
}

export function getTusEndpoint(): string {
  const envUrl = import.meta.env.VITE_TUS_URL;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.replace(/\/+$/, '') + '/';
  }

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:8080/files/`;
  }

  return 'http://localhost:8080/files/';
}
