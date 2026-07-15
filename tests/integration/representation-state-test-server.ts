import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';

export type TestServer = { baseUrl: string; process: ChildProcess | null; stop(): Promise<void> };

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Unable to allocate test port'));
      server.close(() => resolve(address.port));
    });
  });
}

export async function assertZeya(baseUrl: string): Promise<void> {
  const url = `${baseUrl}/api/health`;
  const response = await fetch(url);
  const type = response.headers.get('content-type') || '';
  const raw = await response.text();
  if (!response.ok || !type.includes('application/json')) throw new Error(`Expected Zeya JSON API but received ${type || 'unknown'} from ${url}`);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new Error(`Invalid JSON from ${url}`); }
  const value = body as Record<string, unknown>;
  if (value.application !== 'zeya' || value.service !== 'canonical-representation-state') throw new Error(`Unexpected application identity from ${url}`);
}

export async function startTestServer(): Promise<TestServer> {
  const explicit = process.env.REPRESENTATION_TEST_BASE_URL?.replace(/\/$/, '');
  if (explicit) { await assertZeya(explicit); return { baseUrl: explicit, process: null, stop: async () => {} }; }
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(port)], { cwd: process.cwd(), stdio: ['ignore', 'inherit', 'inherit'], env: process.env, detached: true });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { try { await assertZeya(baseUrl); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  await assertZeya(baseUrl);
  return { baseUrl, process: child, stop: () => new Promise(resolve => { if(child.exitCode!==null)return resolve(); child.once('exit', () => resolve()); if(child.pid)process.kill(-child.pid,'SIGTERM'); }) };
}
