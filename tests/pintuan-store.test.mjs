import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { PintuanStore } = require('../packages/server/dist/pintuan.store.js');
const { emptyGroup, priceCents, beijingTime, validateGroup } = require('../packages/contracts/dist/index.js');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=', 'base64');
const status = code => error => error.getStatus?.() === code;
const date = time => new Date(time + 8 * 3600000).toISOString().slice(0, 16);

test('金额、库存、必填、规格和北京时间的共享边界', () => {
  assert.equal(priceCents('0.01'), 1);
  assert.equal(priceCents('99999.99'), 9999999);
  for (const value of ['0', '-1', '1.001', '1e2', 'Infinity', '100000']) assert.equal(priceCents(value), null, value);
  assert.ok(Number.isNaN(beijingTime('2030-02-30T12:00')));
  assert.equal(beijingTime('2030-01-01T08:00'), Date.parse('2030-01-01T00:00:00Z'));
  assert.deepEqual(validateGroup(emptyGroup(), false).errors, {});
  const missing = validateGroup(emptyGroup(), true).errors;
  for (const key of ['title', 'description', 'coverId', 'specs.0.name', 'specs.0.price', 'specs.0.stock', 'minimum', 'deadline', 'shippingAt']) assert.ok(missing[key], key);
  for (const stock of ['-1', '0', '1.5', '10000']) assert.ok(validateGroup({ ...emptyGroup(), specs: [{ name: '规格', price: '1.00', stock }] }, false).errors['specs.0.stock']);
  assert.ok(validateGroup({ ...emptyGroup(), specs: [{ name: '重复', price: '', stock: '' }, { name: ' 重复 ', price: '', stock: '' }] }, false).errors['specs.1.name']);
  assert.ok(validateGroup({ ...emptyGroup(), ownerId: 'other' }, false).errors.form);
});

test('PRD 字段上界、多规格库存合计和时间顺序', () => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  const input = { ...emptyGroup(), title: '测试商品', description: '说明', coverId: randomUUID(), specs: [{ name: '小份', price: '0.01', stock: '1' }, { name: '大份', price: '99999.99', stock: '9999' }], minimum: '10000', deadline: '2030-01-02T08:00', shippingAt: '2030-01-03T08:00' };
  assert.deepEqual(validateGroup(input, true, now).errors, {});
  for (const title of ['短', '名'.repeat(41)]) assert.ok(validateGroup({ ...input, title }, true, now).errors.title);
  assert.ok(validateGroup({ ...input, description: '说'.repeat(2001) }, true, now).errors.description);
  assert.ok(validateGroup({ ...input, specs: Array.from({ length: 21 }, (_, i) => ({ name: String(i), price: '1', stock: '1' })) }, true, now).errors.specs);
  assert.ok(validateGroup({ ...input, specs: [{ name: '规'.repeat(31), price: '1', stock: '1' }] }, true, now).errors['specs.0.name']);
  assert.ok(validateGroup({ ...input, detailImageIds: Array.from({ length: 9 }, () => randomUUID()) }, true, now).errors.detailImageIds);
  assert.ok(validateGroup({ ...input, minimum: '10001' }, true, now).errors.minimum);
  assert.ok(validateGroup({ ...input, deadline: '2030-01-01T08:00' }, true, now).errors.deadline);
  assert.ok(validateGroup({ ...input, shippingAt: input.deadline }, true, now).errors.shippingAt);
});

test('保存、再次编辑、预览、幂等发布、权限、冻结及进程重读', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pintuan-store-test-'));
  const previous = process.env.PINTUAN_DB_PATH;
  process.env.PINTUAN_DB_PATH = join(directory, 'test.sqlite');
  let store = new PintuanStore();
  try {
    store.addAccount('leader_a', '测试团长甲', 'test-password-only-a', true);
    store.addAccount('leader_b', '测试团长乙', 'test-password-only-b', true);
    store.addAccount('buyer', '测试购买者', 'test-password-buyer', false);
    const a = store.login({ username: 'leader_a', password: 'test-password-only-a' });
    const b = store.login({ username: 'leader_b', password: 'test-password-only-b' });
    const buyer = store.login({ username: 'buyer', password: 'test-password-buyer' });
    const cookie = `pintuan_session=${a.token}`;
    assert.equal(store.leader(cookie).id, a.account.id);
    assert.throws(() => store.leader(`pintuan_session=${buyer.token}`), status(403));
    assert.throws(() => store.account(undefined), status(401));
    const requestId = randomUUID();
    const draft = store.create(a.account, { requestId, input: emptyGroup() });
    assert.equal(store.create(a.account, { requestId, input: emptyGroup() }).id, draft.id);
    assert.equal(store.list(a.account).length, 1);
    assert.equal(store.list().length, 0);
    assert.throws(() => store.get(draft.id), status(404));
    assert.throws(() => store.get(draft.id, b.account), status(404));
    assert.throws(() => store.save(b.account, draft.id, { revision: 1, input: emptyGroup() }), status(404));
    assert.throws(() => store.remove(b.account, draft.id, { revision: 1 }), status(404));
    assert.throws(() => store.preview(b.account, draft.id, { revision: 1 }), status(404));
    assert.throws(() => store.publish(b.account, draft.id, { confirmed: true }), status(404));
    assert.throws(() => store.preview(a.account, draft.id, { revision: 1 }), status(400));
    const deletedKey = randomUUID();
    const removable = store.create(a.account, { requestId: deletedKey, input: emptyGroup() });
    assert.deepEqual(store.remove(a.account, removable.id, { revision: removable.revision }), { deleted: true });
    assert.throws(() => store.get(removable.id, a.account), status(404));
    assert.throws(() => store.create(a.account, { requestId: deletedKey, input: emptyGroup() }), status(409));
    assert.equal(store.list(a.account).length, 1);
    const coverId = store.upload(a.account, { buffer: image, size: image.length, mimetype: 'image/png' }).id;
    assert.throws(() => store.image(coverId, b.account), status(404));
    assert.throws(() => store.image(coverId, null), status(404));
    assert.throws(() => store.upload(a.account, { buffer: Buffer.from('<script>'), size: 8, mimetype: 'image/png' }), status(400));
    assert.throws(() => store.upload(a.account, { buffer: image, size: 5 * 1024 * 1024 + 1, mimetype: 'image/png' }), status(400));
    assert.throws(() => store.upload(a.account, { buffer: image, size: image.length, mimetype: 'image/gif' }), status(400));
    const input = { title: '真实发布测试', description: '数据库中的测试商品', coverId, detailImageIds: [], specs: [{ name: '一份', price: '0.29', stock: '10' }], minimum: '2', deadline: date(Date.now() + 3600000), shippingAt: date(Date.now() + 7200000) };
    assert.throws(() => store.save(b.account, store.create(b.account, { requestId: randomUUID(), input: emptyGroup() }).id, { revision: 1, input }), status(400));
    const saved = store.save(a.account, draft.id, { revision: draft.revision, input });
    assert.equal(store.get(saved.id, a.account).specs[0].priceCents, 29);
    assert.throws(() => store.save(a.account, draft.id, { revision: 1, input }), status(409));
    const preview = store.preview(a.account, saved.id, { revision: saved.revision });
    assert.equal(preview.group.status, 'draft');
    assert.throws(() => store.publish(a.account, saved.id, { revision: saved.revision, confirmed: true, previewToken: 'wrong' }), status(409));
    const publish = { revision: saved.revision, confirmed: true, previewToken: preview.previewToken };
    const published = store.publish(a.account, saved.id, publish);
    assert.equal(published.status, 'published');
    assert.equal(published.displayStatus, 'ongoing');
    assert.deepEqual(store.publish(a.account, saved.id, publish), published);
    assert.equal(store.list().length, 1);
    assert.throws(() => store.save(a.account, saved.id, { revision: published.revision, input }), status(409));
    assert.throws(() => store.remove(a.account, saved.id, { revision: published.revision }), status(409));
    assert.deepEqual(Buffer.from(store.image(coverId, null).bytes), image);
    store.onModuleDestroy();
    store = new PintuanStore();
    assert.deepEqual(store.get(saved.id), published);
    assert.equal(store.account(cookie).id, a.account.id);
    store.logout(cookie);
    assert.throws(() => store.account(cookie), status(401));
    const db = new DatabaseSync(process.env.PINTUAN_DB_PATH);
    try {
      assert.throws(() => db.prepare('UPDATE specs SET price_cents=-1 WHERE group_id=?').run(saved.id), /CHECK/);
      assert.throws(() => db.prepare('UPDATE specs SET stock=-1 WHERE group_id=?').run(saved.id), /CHECK/);
      const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM groups WHERE status='published' ORDER BY published_at DESC").all();
      assert.ok(plan.some(row => row.detail.includes('groups_public')));
      db.prepare('UPDATE groups SET deadline=? WHERE id=?').run('2000-01-01T00:00', saved.id);
      assert.equal(store.get(saved.id).displayStatus, 'ended');
    } finally { db.close(); }
  } finally {
    store.onModuleDestroy();
    if (previous === undefined) delete process.env.PINTUAN_DB_PATH;
    else process.env.PINTUAN_DB_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
