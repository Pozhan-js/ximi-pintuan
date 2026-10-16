import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const webDir = fileURLToPath(new URL('../packages/web/', import.meta.url));
const webRequire = createRequire(new URL('../packages/web/package.json', import.meta.url));
const children = [];
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pintuan-smoke-'));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function launch(args, cwd, env) {
  const child = spawn(process.execPath, args, {
    cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let failure;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => { output = (output + data.toString()).slice(-8000); });
  }
  child.on('error', (error) => { failure = error; });
  children.push(child);
  return { child, output: () => output, failure: () => failure };
}

async function waitReady(url, processInfo) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (processInfo.failure()) throw processInfo.failure();
    if (processInfo.child.exitCode !== null || processInfo.child.signalCode !== null) {
      throw new Error(`服务启动失败：${processInfo.output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* The child is still starting. */ }
    await delay(250);
  }
  throw new Error(`等待服务超时：${processInfo.output()}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
  });
}

async function get(url) {
  return fetch(url, { signal: AbortSignal.timeout(5000) });
}

try {
  const webPort = await unusedPort();
  let serverPort = await unusedPort();
  while (serverPort === webPort) serverPort = await unusedPort();
  const webUrl = `http://127.0.0.1:${webPort}`;
  const serverUrl = `http://127.0.0.1:${serverPort}/api`;
  const web = launch([
    webRequire.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(webPort),
  ], webDir, { SERVER_API_URL: serverUrl, NEXT_TELEMETRY_DISABLED: '1' });
  await waitReady(webUrl, web);
  const home = await get(webUrl);
  assert.match(await home.text(), /拼团哇/);
  const prototype = await get(`${webUrl}/prototype/index.html`);
  assert.equal(prototype.status, 200);
  assert.deepEqual(Buffer.from(await prototype.arrayBuffer()), await readFile(
    new URL('../docs/design/拼团哇-可点击原型-375x812.html', import.meta.url),
  ));
  assert.equal((await get(`${webUrl}/api/server-health`)).status, 503);
  console.log('PASS: Next 独立启动、原型与原文件一致、未启动后端时返回 503');

  const server = launch(['packages/server/dist/main.js'], root, {
    PORT: String(serverPort), HOST: '127.0.0.1', PINTUAN_DB_PATH: join(temporaryDirectory, 'smoke.sqlite'),
  });
  await waitReady(`${serverUrl}/health`, server);
  const expected = { status: 'ok', service: 'pintuan-server' };
  assert.deepEqual(await (await get(`${serverUrl}/health`)).json(), expected);
  const bridge = await get(`${webUrl}/api/server-health`);
  assert.equal(bridge.status, 200);
  assert.deepEqual(await bridge.json(), expected);
  console.log('PASS: 编译后的 Nest 服务与 Next 到 Nest 的接口联通');

  await stop(server.child);
  assert.equal((await get(`${webUrl}/api/server-health`)).status, 503);
  console.log('PASS: 后端停止后返回 503，不复用旧的成功结果');
} finally {
  await Promise.all(children.map(stop));
  await rm(temporaryDirectory, { recursive: true, force: true });
}
