import { Injectable, BadRequestException, ConflictException, NotFoundException, UnauthorizedException, ForbiddenException, HttpException, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { GroupInput, GroupRecord, validateGroup, priceCents, groupInput, beijingTime } from '@pintuan/contracts';

export interface Account { id: string; name: string; leader: boolean }
interface GroupRow {
  id: string; owner_id: string; title: string; description: string; cover_id: string; detail_images: string;
  minimum: string; deadline: string; shipping_at: string; status: 'draft' | 'published' | 'deleted';
  revision: number; published_at: string | null; preview_token: string | null; preview_at: number | null;
}
const unavailable = () => new NotFoundException('无法访问该拼团，请返回我的拼团。');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class PintuanStore implements OnModuleDestroy {
  private readonly db: DatabaseSync;
  constructor() {
    const path = process.env.PINTUAN_DB_PATH ?? join(__dirname, '../data/pintuan.sqlite');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(readFileSync(join(__dirname, '../migrations/001-pintuan.sql'), 'utf8'));
  }
  onModuleDestroy() { this.db.close(); }
  addAccount(username: string, name: string, password: string, leader: boolean) {
    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(username) || name.length < 1 || name.length > 40 || password.length < 12 || password.length > 128) throw new Error('账号需为 3～40 位字母数字，名称 1～40 字，密码 12～128 字。');
    const salt = randomBytes(16).toString('hex');
    this.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)').run(randomUUID(), username, name, scryptSync(password, salt, 64).toString('hex'), salt, Number(leader));
  }
  login(body: unknown): { account: Account; token: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('请填写账号和密码。');
    const v = body as Record<string, unknown>;
    if (typeof v.username !== 'string' || !/^[a-zA-Z0-9_-]{3,40}$/.test(v.username) || typeof v.password !== 'string' || v.password.length > 128) throw new UnauthorizedException('账号或密码不正确，请核对后重试。');
    const key = v.username.toLowerCase(), now = Date.now();
    const attempt = this.db.prepare('SELECT attempts,started_at FROM login_attempts WHERE username=?').get(key) as { attempts: number; started_at: number } | undefined;
    if (attempt && attempt.started_at > now - 15 * 60000 && attempt.attempts >= 5) throw new HttpException('尝试次数过多，请 15 分钟后重试。', 429);
    const row = this.db.prepare('SELECT * FROM accounts WHERE username=?').get(v.username) as { id: string; name: string; leader: number; password_hash: string; salt: string } | undefined;
    const hash = scryptSync(v.password, row?.salt ?? 'unregistered-account', 64);
    if (!timingSafeEqual(hash, row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64))) {
      this.db.prepare('INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(username) DO UPDATE SET attempts=CASE WHEN started_at < ? THEN 1 ELSE attempts+1 END, started_at=CASE WHEN started_at < ? THEN excluded.started_at ELSE started_at END').run(key, now, now - 15 * 60000, now - 15 * 60000);
      throw new UnauthorizedException('账号或密码不正确，请核对后重试。');
    }
    if (!row) throw new UnauthorizedException('请重新登录。');
    this.db.prepare('DELETE FROM login_attempts WHERE username=?').run(key);
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), row.id, now + 8 * 3600000);
    return { account: { id: row.id, name: row.name, leader: !!row.leader }, token };
  }
  account(cookie: string | undefined, required = true): Account | null {
    const token = cookie?.match(/(?:^|;\s*)pintuan_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const row = token ? this.db.prepare('SELECT a.id,a.name,a.leader FROM accounts a JOIN sessions s ON a.id=s.account_id WHERE s.hash=? AND s.expires_at>?').get(digest(token), Date.now()) as { id: string; name: string; leader: number } | undefined : undefined;
    if (!row && required) throw new UnauthorizedException('请登录后管理自己的拼团。');
    return row ? { id: row.id, name: row.name, leader: !!row.leader } : null;
  }
  logout(cookie: string | undefined) {
    const token = cookie?.match(/(?:^|;\s*)pintuan_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token) this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));
  }
  leader(cookie: string | undefined): Account {
    const account = this.account(cookie)!;
    if (!account.leader) throw new ForbiddenException('当前账号没有团长资格，请联系负责人。');
    return account;
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private row(id: string): GroupRow | undefined {
    return this.db.prepare("SELECT * FROM groups WHERE id=? AND status<>'deleted'").get(id) as unknown as GroupRow | undefined;
  }
  private owned(id: string, account: Account): GroupRow {
    const row = this.row(id);
    if (!row || row.owner_id !== account.id) throw unavailable();
    return row;
  }
  private record(row: GroupRow): GroupRecord {
    const specs = this.db.prepare('SELECT name,price_cents,stock FROM specs WHERE group_id=? ORDER BY position').all(row.id) as { name: string; price_cents: number | null; stock: number | null }[];
    return { id: row.id, title: row.title, description: row.description, coverId: row.cover_id,
      detailImageIds: JSON.parse(row.detail_images), minimum: row.minimum, deadline: row.deadline, shippingAt: row.shipping_at,
      status: row.status === 'published' ? 'published' : 'draft', revision: row.revision, publishedAt: row.published_at,
      displayStatus: row.status !== 'published' ? 'draft' : beijingTime(row.deadline) > Date.now() ? 'ongoing' : 'ended',
      specs: specs.map(s => ({ name: s.name, price: s.price_cents === null ? '' : (s.price_cents / 100).toFixed(2), stock: s.stock === null ? '' : String(s.stock), priceCents: s.price_cents })) };
  }
  private valid(value: unknown, account: Account, publish = false): GroupInput {
    const { input, errors } = validateGroup(value, publish);
    if (input) {
      for (const [field, ids] of [['coverId', [input.coverId]], ['detailImageIds', input.detailImageIds]] as const) {
        for (const id of ids.filter(Boolean)) {
          if (!this.db.prepare('SELECT id FROM images WHERE id=? AND owner_id=?').get(id, account.id)) errors[field] = '图片不可用，请使用本人账号重新上传。';
        }
      }
    }
    if (!input || Object.keys(errors).length) throw new BadRequestException({ message: '请修正标出的字段后重试。', errors });
    return input;
  }
  private specs(id: string, input: GroupInput) {
    this.db.prepare('DELETE FROM specs WHERE group_id=?').run(id);
    input.specs.forEach((s, i) => this.db.prepare('INSERT INTO specs VALUES (?,?,?,?,?)').run(id, i, s.name, s.price ? priceCents(s.price) : null, s.stock ? Number(s.stock) : null));
  }
  create(account: Account, body: unknown): GroupRecord {
    const v = this.body(body);
    if (typeof v.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(v.requestId)) throw new BadRequestException('创建请求无效，请重新打开新建页面。');
    const requestId = v.requestId;
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM groups WHERE owner_id=? AND request_key=?').get(account.id, requestId) as unknown as GroupRow | undefined;
      if (existing) { if (existing.status === 'deleted') throw new ConflictException('该草稿已删除，请重新新建。'); return this.record(existing); }
      const input = this.valid(v.input, account);
      const id = randomUUID();
      this.db.prepare("INSERT INTO groups (id,owner_id,request_key,title,description,cover_id,detail_images,minimum,deadline,shipping_at,status,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'draft',1,?)").run(id, account.id, requestId, input.title, input.description, input.coverId, JSON.stringify(input.detailImageIds), input.minimum, input.deadline, input.shippingAt, Date.now());
      this.specs(id, input);
      return this.record(this.owned(id, account));
    });
  }
  private body(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('请求格式无效，请刷新页面后重试。');
    return body as Record<string, unknown>;
  }
  private editable(row: GroupRow, revision: unknown) {
    if (row.status !== 'draft') throw new ConflictException('拼团已发布，商品与交易规则已冻结。');
    if (row.revision !== revision) throw new ConflictException('草稿已在另一窗口更新，请重新加载后编辑。');
  }
  save(account: Account, id: string, body: unknown): GroupRecord {
    const v = this.body(body);
    return this.transaction(() => {
      const row = this.owned(id, account); this.editable(row, v.revision);
      const input = this.valid(v.input, account);
      this.db.prepare('UPDATE groups SET title=?,description=?,cover_id=?,detail_images=?,minimum=?,deadline=?,shipping_at=?,revision=revision+1,updated_at=?,preview_token=NULL,preview_at=NULL WHERE id=?').run(input.title, input.description, input.coverId, JSON.stringify(input.detailImageIds), input.minimum, input.deadline, input.shippingAt, Date.now(), id);
      this.specs(id, input); return this.record(this.owned(id, account));
    });
  }
  preview(account: Account, id: string, body: unknown) {
    const v = this.body(body);
    return this.transaction(() => {
      const row = this.owned(id, account); this.editable(row, v.revision);
      const group = this.record(row);
      this.valid(groupInput(group), account, true);
      const token = randomUUID();
      this.db.prepare('UPDATE groups SET preview_token=?,preview_at=? WHERE id=?').run(token, Date.now(), id);
      return { group, previewToken: token };
    });
  }
  publish(account: Account, id: string, body: unknown) {
    const v = this.body(body);
    return this.transaction(() => {
      const row = this.owned(id, account);
      if (v.confirmed !== true || !row.preview_token || row.preview_token !== v.previewToken) throw new ConflictException('请重新预览并确认发布。');
      if (row.status === 'published') return this.record(row);
      this.editable(row, v.revision);
      if (!row.preview_at || Date.now() - row.preview_at > 15 * 60000) throw new ConflictException('预览已过期，请重新预览后发布。');
      this.valid(groupInput(this.record(row)), account, true);
      this.db.prepare("UPDATE groups SET status='published',published_at=?,revision=revision+1,updated_at=? WHERE id=?").run(new Date().toISOString(), Date.now(), id);
      return this.record(this.owned(id, account));
    });
  }
  remove(account: Account, id: string, body: unknown) {
    const v = this.body(body);
    return this.transaction(() => {
      const row = this.owned(id, account); this.editable(row, v.revision);
      this.db.prepare("UPDATE groups SET status='deleted',revision=revision+1,updated_at=? WHERE id=?").run(Date.now(), id);
      return { deleted: true };
    });
  }
  list(account?: Account): GroupRecord[] {
    const rows = (account ? this.db.prepare("SELECT * FROM groups WHERE owner_id=? AND status<>'deleted' ORDER BY updated_at DESC").all(account.id) : this.db.prepare("SELECT * FROM groups WHERE status='published' ORDER BY published_at DESC").all()) as unknown as GroupRow[];
    return rows.map(r => this.record(r));
  }
  get(id: string, account?: Account): GroupRecord {
    const row = account ? this.owned(id, account) : this.row(id);
    if (!row || (!account && row.status !== 'published')) throw unavailable();
    return this.record(row);
  }
  upload(account: Account, file: { buffer: Buffer; mimetype: string; size: number } | undefined) {
    if (!file || file.size < 1 || file.size > 5 * 1024 * 1024) throw new BadRequestException('请上传不超过 5MB 的 JPG / PNG 图片。');
    const png = file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = file.buffer[0] === 255 && file.buffer[1] === 216 && file.buffer[2] === 255;
    if (!(png && file.mimetype === 'image/png') && !(jpeg && file.mimetype === 'image/jpeg')) throw new BadRequestException('文件内容不是 JPG / PNG 图片，请重新选择。');
    const id = randomUUID();
    this.db.prepare('INSERT INTO images VALUES (?,?,?,?)').run(id, account.id, file.mimetype, file.buffer);
    return { id };
  }
  image(id: string, account: Account | null) {
    const row = this.db.prepare('SELECT * FROM images WHERE id=?').get(id) as { owner_id: string; mime: string; bytes: Uint8Array } | undefined;
    const publicUse = this.db.prepare("SELECT g.id FROM groups g WHERE status='published' AND (cover_id=? OR EXISTS (SELECT 1 FROM json_each(g.detail_images) WHERE value=?)) LIMIT 1").get(id, id);
    if (!row || (!publicUse && row.owner_id !== account?.id)) throw new NotFoundException('图片不可用。');
    return { mime: row.mime, bytes: row.bytes };
  }
}
