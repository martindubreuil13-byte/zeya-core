export async function jsonRequest<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const url = new URL(path, baseUrl).toString();
  const response = await fetch(url, init);
  const type = response.headers.get('content-type') || '';
  const raw = await response.text();
  if (!type.includes('application/json')) throw new Error(`Expected Zeya JSON API but received ${type || 'unknown'} from ${url}`);
  try { return { status: response.status, body: JSON.parse(raw) as T }; }
  catch { throw new Error(`Invalid JSON response for ${init.method || 'GET'} ${url}`); }
}
