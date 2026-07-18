import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';

export type TestServer = {
  baseUrl: string;
  process: ChildProcess | null;
  recentLogs(): string;
  stop(): Promise<void>;
};

function sanitizeServerLog(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[redacted-jwt]')
    .replace(/(?:service_role|SUPABASE_SERVICE_ROLE_KEY)\s*[=:]\s*\S+/gi, '$1=[redacted]');
}

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
  if (explicit) {
    await assertZeya(explicit);
    return { baseUrl: explicit, process: null, recentLogs: () => '', stop: async () => {} };
  }
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs: string[] = [];
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const capture = (chunk: Buffer | string) => {
    logs.push(sanitizeServerLog(String(chunk)));
    if (logs.length > 200) logs.splice(0, logs.length - 200);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { try { await assertZeya(baseUrl); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  await assertZeya(baseUrl);
  return {
    baseUrl,
    process: child,
    recentLogs: () => logs.join('').slice(-12_000),
    stop: () => new Promise(resolve => { if(child.exitCode!==null)return resolve(); child.once('exit', () => resolve()); child.kill('SIGTERM'); }),
  };
}
