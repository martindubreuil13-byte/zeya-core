import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';

export type TestServer = {
  baseUrl: string;
  process: ChildProcess | null;
  recentLogs(): string;
  stop(): Promise<void>;
};

export type TestServerOptions = {
  envOverrides?: Record<string, string>;
  allowExternal?: boolean;
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

export async function assertZeya(baseUrl: string, signal?: AbortSignal): Promise<void> {
  const url = `${baseUrl}/api/health`;
  const response = await fetch(url, { signal });
  const type = response.headers.get('content-type') || '';
  const raw = await response.text();
  if (!response.ok || !type.includes('application/json')) throw new Error(`Expected Zeya JSON API but received ${type || 'unknown'} from ${url}`);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new Error(`Invalid JSON from ${url}`); }
  const value = body as Record<string, unknown>;
  if (value.application !== 'zeya' || value.service !== 'canonical-representation-state') throw new Error(`Unexpected application identity from ${url}`);
}

export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const explicit = process.env.REPRESENTATION_TEST_BASE_URL?.replace(/\/$/, '');
  if (explicit && options.allowExternal !== false) {
    await assertZeya(explicit);
    return { baseUrl: explicit, process: null, recentLogs: () => '', stop: async () => {} };
  }
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs: string[] = [];
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, ...(options.envOverrides ?? {}), PORT: String(port) },
  });
  const parentPid = process.pid;
  const processGroup = child.pid;
  const parentWatchdog = setInterval(() => {
    if (child.exitCode !== null || !processGroup) return;
    try { process.kill(parentPid, 0); } catch {
      try { process.kill(-processGroup, 'SIGTERM'); } catch { /* already stopped */ }
      clearInterval(parentWatchdog);
    }
  }, 1_000);
  parentWatchdog.unref();
  const capture = (chunk: Buffer | string) => {
    logs.push(sanitizeServerLog(String(chunk)));
    if (logs.length > 200) logs.splice(0, logs.length - 200);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const stopChild = async () => {
    clearInterval(parentWatchdog);
    if (child.exitCode !== null) return;
    try { if (processGroup) process.kill(-processGroup, 'SIGTERM'); else child.kill('SIGTERM'); } catch { child.kill('SIGTERM'); }
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  };
  const deadline = Date.now() + 30_000;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited before readiness exit_code=${child.exitCode} signal=${child.signalCode ?? 'none'} port=${port} last_health_error=${lastError} logs=${logs.join('').slice(-4000)}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try { await assertZeya(baseUrl, controller.signal); clearTimeout(timer); break; }
    catch (error) { clearTimeout(timer); lastError = error instanceof Error ? error.message : 'health request failed'; await new Promise(r => setTimeout(r, 250)); }
  }
  if (child.exitCode !== null) throw new Error(`server exited before readiness exit_code=${child.exitCode} signal=${child.signalCode ?? 'none'} port=${port} last_health_error=${lastError} logs=${logs.join('').slice(-4000)}`);
  try { await assertZeya(baseUrl); }
  catch (error) { await stopChild(); throw new Error(`server not ready port=${port} last_health_error=${error instanceof Error ? error.message : 'health request failed'} logs=${logs.join('').slice(-4000)}`); }
  return {
    baseUrl,
    process: child,
    recentLogs: () => logs.join('').slice(-12_000),
    stop: stopChild,
  };
}
