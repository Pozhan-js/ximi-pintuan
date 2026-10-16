import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const webDir = join(root, 'packages/web');
const require = createRequire(import.meta.url);
const webRequire = createRequire(new URL('../packages/web/package.json', import.meta.url));
const { PintuanStore } = require('../packages/server/dist/pintuan.store.js');
const { emptyGroup } = require('../packages/contracts/dist/index.js');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=', 'base64');
async function port() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
function launch(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes.toString()).slice(-4000); });
  return { child, output: () => output };
}
async function ready(url, info) {
  for (let i = 0; i < 120; i++) {
    if (info.child.exitCode !== null) throw new Error(info.output());
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Own service is starting. */ }
    await delay(250);
  }
  throw new Error('Test service did not become ready: ' + info.output());
}
async function stop(info) {
  if (!info || info.child.exitCode !== null || info.child.signalCode !== null) return;
  await new Promise(resolve => {
    info.child.once('exit', resolve); info.child.kill('SIGTERM');
    const timer = setTimeout(() => info.child.kill('SIGKILL'), 5000);
    timer.unref(); info.child.once('exit', () => clearTimeout(timer));
  });
}

test('真实 Next BFF → Nest → SQLite 完整链路、权限、失败及并发发布', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pintuan-http-test-'));
  const previous = process.env.PINTUAN_DB_PATH;
  const db = join(directory, 'test.sqlite');
  process.env.PINTUAN_DB_PATH = db;
  const store = new PintuanStore();
  try {
    for (const [username, leader] of [['leader_a', true], ['leader_b', true], ['buyer', false]]) store.addAccount(username, username, 'test-password-only', leader);
  } finally {
    store.onModuleDestroy();
    if (previous === undefined) delete process.env.PINTUAN_DB_PATH; else process.env.PINTUAN_DB_PATH = previous;
  }
  const webPort = await port(); let serverPort = await port();
  while (serverPort === webPort) serverPort = await port();
  const webUrl = `http://127.0.0.1:${webPort}`;
  const serverUrl = `http://127.0.0.1:${serverPort}/api`;
  let web; let server;
  const request = async (path, method = 'GET', body, cookie = '', origin = webUrl) => {
    const form = body instanceof FormData;
    const response = await fetch(`${webUrl}/api/pintuan/${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { origin } : {}), ...(body && !form ? { 'content-type': 'application/json' } : {}) }, body: body ? form ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    return { response, status: response.status, value: await response.json() };
  };
  try {
    web = launch([webRequire.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(webPort)], webDir, { SERVER_API_URL: serverUrl, NEXT_TELEMETRY_DISABLED: '1' });
    await ready(webUrl, web);
    assert.equal((await request('groups')).status, 503);
    server = launch(['packages/server/dist/main.js'], root, { PORT: String(serverPort), HOST: '127.0.0.1', PINTUAN_DB_PATH: db });
    await ready(`${serverUrl}/health`, server);
    assert.equal((await request('leader/groups')).status, 401);
    assert.equal((await request('auth/login', 'POST', { username: 'leader_a', password: 'test-password-only' }, '', 'https://untrusted.invalid')).status, 403);
    assert.equal((await request('auth/logout', 'POST', {}, '', `http://localhost:${webPort}`)).status, 403);
    const login = async username => {
      const result = await request('auth/login', 'POST', { username, password: 'test-password-only' });
      assert.equal(result.status, 201);
      assert.match(result.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
      return result.response.headers.get('set-cookie').split(';')[0];
    };
    const a = await login('leader_a'); const b = await login('leader_b'); const buyer = await login('buyer');
    assert.equal((await request('leader/groups', 'GET', undefined, buyer)).status, 403);
    assert.equal((await request('leader/groups', 'GET', undefined, 'pintuan_session=' + '0'.repeat(64))).status, 401);
    const requestId = randomUUID();
    const created = await request('leader/groups', 'POST', { requestId, input: emptyGroup() }, a);
    assert.equal(created.status, 201); const id = created.value.id;
    assert.equal((await request('leader/groups', 'POST', { requestId, input: emptyGroup() }, a)).value.id, id);
    assert.equal((await request(`groups/${id}`)).status, 404);
    assert.equal((await request(`leader/groups/${id}`, 'GET', undefined, b)).status, 404);
    assert.equal((await request(`leader/groups/${id}`, 'PUT', { revision: 1, input: emptyGroup() }, b)).status, 404);
    assert.equal((await request(`leader/groups/${id}/publish`, 'POST', { revision: 1, confirmed: true }, b)).status, 404);
    const missing = await request(`leader/groups/${id}/preview`, 'POST', { revision: 1 }, a);
    assert.equal(missing.status, 400); assert.ok(missing.value.errors.title);
    const bad = await request(`leader/groups/${id}`, 'PUT', { revision: 1, input: { ...emptyGroup(), specs: [{ name: '一份', price: '0.001', stock: '-1' }], deadline: '2030-02-30T12:00' } }, a);
    assert.equal(bad.status, 400);
    for (const key of ['specs.0.price', 'specs.0.stock', 'deadline']) assert.ok(bad.value.errors[key]);
    const forged = await request(`leader/groups/${id}`, 'PUT', { revision: 1, input: { ...emptyGroup(), status: 'published', ownerId: 'someone-else' } }, a);
    assert.equal(forged.status, 400);
    const form = new FormData(); form.set('file', new Blob([image], { type: 'image/png' }), 'cover.png');
    const cover = await request('media', 'POST', form, a); assert.equal(cover.status, 201);
    assert.equal((await fetch(`${webUrl}/api/pintuan/media/${cover.value.id}`)).status, 404);
    const date = time => new Date(time + 8 * 3600000).toISOString().slice(0, 16);
    const input = { title: 'HTTP 发布测试', description: '发布后买家回读真实数据库记录', coverId: cover.value.id, detailImageIds: [], specs: [{ name: '一份', price: '0.29', stock: '10' }], minimum: '2', deadline: date(Date.now() + 3600000), shippingAt: date(Date.now() + 7200000) };
    const saved = await request(`leader/groups/${id}`, 'PUT', { revision: 1, input }, a);
    assert.equal(saved.status, 200); assert.equal(saved.value.specs[0].priceCents, 29);
    assert.equal((await request(`leader/groups/${id}`, 'GET', undefined, a)).value.title, input.title);
    assert.equal((await request(`leader/groups/${id}`, 'PUT', { revision: 1, input }, a)).status, 409);
    const preview = await request(`leader/groups/${id}/preview`, 'POST', { revision: saved.value.revision }, a);
    assert.equal(preview.status, 201); assert.equal(preview.value.group.status, 'draft');
    assert.equal((await request(`groups/${id}`)).status, 404);
    const publish = { revision: saved.value.revision, previewToken: preview.value.previewToken, confirmed: true };
    const results = await Promise.all(Array.from({ length: 6 }, () => request(`leader/groups/${id}/publish`, 'POST', publish, a)));
    for (const result of results) { assert.equal(result.status, 201); assert.equal(result.value.id, id); assert.equal(result.value.revision, saved.value.revision + 1); }
    const publicDetail = await request(`groups/${id}`);
    assert.equal(publicDetail.status, 200); assert.equal(publicDetail.value.displayStatus, 'ongoing');
    assert.equal(publicDetail.value.specs[0].priceCents, 29); assert.equal(publicDetail.value.title, input.title);
    assert.equal('ownerId' in publicDetail.value, false); assert.equal('previewToken' in publicDetail.value, false);
    assert.equal((await request('groups')).value.length, 1);
    assert.equal((await request(`leader/groups/${id}`, 'PUT', { revision: publicDetail.value.revision, input }, a)).status, 409);
    assert.equal((await request(`leader/groups/${id}`, 'DELETE', { revision: publicDetail.value.revision }, a)).status, 409);
    const publicImage = await fetch(`${webUrl}/api/pintuan/media/${cover.value.id}`);
    assert.equal(publicImage.status, 200); assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), image);
    assert.equal(publicImage.headers.get('cache-control'), 'no-store');
    await stop(server); server = null;
    assert.equal((await request('groups')).status, 503);
    server = launch(['packages/server/dist/main.js'], root, { PORT: String(serverPort), HOST: '127.0.0.1', PINTUAN_DB_PATH: db });
    await ready(`${serverUrl}/health`, server);
    assert.equal((await request(`groups/${id}`)).value.id, id);
    console.log('PASS: 草稿/保存/编辑/预览/六次并发发布/买家回读/服务重启；权限与非法输入均被拒绝');
  } finally {
    await Promise.all([stop(web), stop(server)]);
    await rm(directory, { recursive: true, force: true });
  }
});
