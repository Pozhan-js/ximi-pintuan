'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { emptyGroup, groupInput, validateGroup, type FieldErrors, type GroupInput, type GroupRecord } from '@pintuan/contracts';

type Account = { name: string; leader: boolean };
type View = 'list' | 'edit' | 'preview' | 'detail';
class ApiError extends Error {
  constructor(message: string, public fields: FieldErrors = {}, public status = 0) { super(message); }
}
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const upload = body instanceof FormData;
  let response: Response;
  try { response = await fetch(`/api/pintuan/${path}`, { method, cache: 'no-store', headers: body && !upload ? { 'content-type': 'application/json' } : undefined, body: body ? upload ? body : JSON.stringify(body) : undefined }); }
  catch { throw new ApiError('网络连接中断，请重试。已填内容会保留。'); }
  const value = await response.json();
  if (!response.ok) throw new ApiError(typeof value.message === 'string' ? value.message : '操作失败，请重试。', value.errors ?? {}, response.status);
  return value as T;
}
function statusText(group: GroupRecord) {
  return { draft: '草稿', ongoing: '进行中', ended: '已截止 · 待结算' }[group.displayStatus];
}
function Product({ group }: { group: GroupRecord }) {
  return <>
    {/* unoptimized 保留浏览器读取本人图片的会话 cookie。 */}
    <Image unoptimized width={800} height={800} className="product-cover" src={`/api/pintuan/media/${group.coverId}`} alt={`${group.title}封面`} />
    <h1>{group.title}</h1><p className="product-description">{group.description}</p>
    <section className="group-card" aria-label="规格价格与库存"><h2>商品规格</h2>{group.specs.map((spec, i) => <div className="spec-summary" key={i}><strong>{spec.name}</strong><span><b className="amount">¥{((spec.priceCents ?? 0) / 100).toFixed(2)}</b> · {spec.stock} 件</span></div>)}</section>
    <section className="group-card"><h2>参团规则</h2><dl className="group-rules"><dt>最低成团件数</dt><dd>{group.minimum} 件</dd><dt>可售总量</dt><dd>{group.specs.reduce((sum, spec) => sum + Number(spec.stock), 0)} 件</dd><dt>截止时间</dt><dd>{group.deadline.replace('T', ' ')} 北京时间</dd><dt>预计发货</dt><dd>{group.shippingAt.replace('T', ' ')} 北京时间</dd></dl><p className="muted">预计发货是团长承诺的时间，不触发自动发货。</p></section>
    {group.detailImageIds.length > 0 && <section className="group-card"><h2>商品详情图</h2>{group.detailImageIds.map((id, i) => <div key={id}>
      <Image unoptimized width={800} height={800} className="product-cover" src={`/api/pintuan/media/${id}`} alt={`商品详情图${i + 1}`} />
    </div>)}</section>}
  </>;
}
function Field({ label, error, id, children }: { label: string; error?: string; id: string; children: ReactNode }) {
  return <div className="group-field"><label htmlFor={id}>{label}</label>{children}{error && <p id={`${id}-error`} className="field-error" role="alert">{error}</p>}</div>;
}

export function PintuanApp({ leader = false, groupId }: { leader?: boolean; groupId?: string }) {
  const router = useRouter();
  const leaveTarget = useRef<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>(groupId ? 'detail' : 'list');
  const [list, setList] = useState<GroupRecord[]>([]);
  const [filter, setFilter] = useState('全部');
  const [group, setGroup] = useState<GroupRecord | null>(null);
  const [input, setInput] = useState<GroupInput>(emptyGroup);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<'coverId' | 'detailImageIds' | null>(null);
  const uploadPending = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [previewToken, setPreviewToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [dialog, setDialog] = useState<'leave' | 'publish' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestId = useRef('');
  const pending = useRef(false);

  const report = (error: unknown) => {
    setFailure(error instanceof Error ? error.message : '操作失败，请重试。');
    if (error instanceof ApiError) setErrors(error.fields);
  };
  const detailId = leader && view === 'detail' && group?.status === 'published' ? group.id : undefined;
  const reload = useCallback(() => {
    const load = async () => {
      if (leader) {
        const current = await api<Account>('auth/me');
        const records = current.leader ? await api<GroupRecord[]>('leader/groups') : [];
        return { account: current, list: records, group: detailId ? await api<GroupRecord>(`leader/groups/${detailId}`) : null };
      }
      if (groupId) return { account: null, list: [], group: await api<GroupRecord>(`groups/${groupId}`) };
      return { account: null, list: await api<GroupRecord[]>('groups'), group: null };
    };
    return load().then(result => {
      setAccount(result.account); setList(result.list);
      if (!leader) setGroup(result.group);
      else if (result.group) setGroup(current => current && current.id === result.group?.id && current.status === 'published' ? result.group : current);
      setFailure('');
    }, error => {
      if (error instanceof ApiError && error.status === 401) setAccount(null);
      else setFailure(error instanceof Error ? error.message : '暂时无法加载，请重试。');
    }).finally(() => setReady(true));
  }, [leader, groupId, detailId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const beforeLeave = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeLeave);
    const refresh = () => { if (document.visibilityState === 'visible' && view !== 'edit' && view !== 'preview') void reload(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { window.clearInterval(timer); window.removeEventListener('beforeunload', beforeLeave); document.removeEventListener('visibilitychange', refresh); };
  }, [dirty, reload, view]);
  useEffect(() => { if (dialog) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [dialog]);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailure(''); setMessage('');
    try { await action(); } catch (error) { report(error); }
    finally { pending.current = false; setBusy(false); }
  }
  const update = (key: keyof GroupInput, value: GroupInput[typeof key]) => {
    setInput(old => ({ ...old, [key]: value })); setDirty(true); setErrors({}); setPreviewToken('');
  };
  async function open(record: GroupRecord) {
    await run(async () => {
      const fresh = await api<GroupRecord>(`${leader ? 'leader/' : ''}groups/${record.id}`);
      setGroup(fresh); setInput(groupInput(fresh)); setDirty(false); setErrors({});
      setView(leader && fresh.status === 'draft' ? 'edit' : 'detail');
    });
  }
  function newDraft() {
    requestId.current = crypto.randomUUID(); setGroup(null); setInput(emptyGroup()); setDirty(false);
    setErrors({}); setMessage(''); setFailure(''); setPreviewToken(''); setView('edit');
  }
  async function save(): Promise<GroupRecord | null> {
    const result = validateGroup(input, false); setErrors(result.errors);
    if (Object.keys(result.errors).length) { setFailure('请修正标出的字段后保存。'); return null; }
    const saved = group
      ? await api<GroupRecord>(`leader/groups/${group.id}`, 'PUT', { input, revision: group.revision })
      : await api<GroupRecord>('leader/groups', 'POST', { input, requestId: requestId.current });
    setGroup(saved); setInput(groupInput(saved)); setDirty(false); setMessage('草稿已保存，仅本人可见。'); return saved;
  }
  async function preview() {
    if (uploading) { setFailure('请等待图片上传完成。'); return; }
    const result = validateGroup(input, true); setErrors(result.errors);
    if (Object.keys(result.errors).length) { setFailure('请修正标出的字段后预览。'); document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center' }); return; }
    await run(async () => {
      const saved = await save(); if (!saved) return;
      const result = await api<{ group: GroupRecord; previewToken: string }>(`leader/groups/${saved.id}/preview`, 'POST', { revision: saved.revision });
      setGroup(result.group); setPreviewToken(result.previewToken); setView('preview'); setMessage('');
    });
  }
  async function upload(file: File | undefined, detail: boolean) {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size < 1) { setErrors(old => ({ ...old, [detail ? 'detailImageIds' : 'coverId']: '请选择不超过 5MB 的 JPG / PNG 图片。' })); return; }
    if (uploadPending.current) return;
    uploadPending.current = true; setUploading(detail ? 'detailImageIds' : 'coverId'); setFailure(''); setDirty(true);
    try {
      const form = new FormData(); form.set('file', file);
      const uploaded = await api<{ id: string }>('media', 'POST', form);
      update(detail ? 'detailImageIds' : 'coverId', detail ? [...input.detailImageIds, uploaded.id] : uploaded.id);
    } catch (error) { report(error); setErrors(old => ({ ...old, [detail ? 'detailImageIds' : 'coverId']: error instanceof Error ? error.message : '上传失败，请重新选择文件重试。' })); }
    finally { uploadPending.current = false; setUploading(null); }
  }
  const invalid = (key: string) => ({ 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `${key}-error` : undefined });
  const canAct = !busy && !uploading;
  const backToList = () => {
    setDialog(null); setDirty(false); setFailure(''); setMessage('');
    if (leaveTarget.current) { const target = leaveTarget.current; leaveTarget.current = null; router.push(target); }
    else { setView('list'); void reload(); }
  };
  const visibleList = list.filter(g => filter === '全部' || filter === statusText(g) || filter === '已结束' && g.displayStatus === 'ended');

  return <main className="pintuan-shell" onClickCapture={event => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (dirty && anchor instanceof HTMLAnchorElement && anchor.origin === location.origin) {
      event.preventDefault(); leaveTarget.current = anchor.pathname + anchor.search + anchor.hash; setDialog('leave');
    }
  }}>
    <header className="pintuan-header"><Link className="brand" href="/">拼团<span className="brand-mark">哇</span></Link><span className="tag">教学环境</span></header>
    <nav className="pintuan-nav" aria-label="拼团导航"><Link href="/groups">拼团广场</Link><Link href="/leader">我的拼团</Link></nav>
    {account && <div className="account-line"><span>{account.name} · {account.leader ? '团长' : '购买者'}</span><button className="text-button" disabled={!canAct || dirty} onClick={() => void run(async () => { await api('auth/logout', 'POST', {}); setAccount(null); setList([]); setGroup(null); setView('list'); })}>退出登录</button></div>}
    <div aria-live="polite">{message && <p className="notice success-notice">{message}</p>}{failure && <div className="notice failure" role="alert"><p>{failure}</p>{view === 'list' || !leader ? <button className="text-button" onClick={() => void reload()}>重试加载</button> : <p>已保留输入，可修正后重试；草稿冲突时请重新加载。</p>}</div>}{uploading && <p className="notice">图片上传中，请稍候…</p>}</div>
    {!ready ? <p className="empty-state" role="status">正在加载拼团…</p> : leader && !account ? <section className="group-card"><h1>登录我的拼团</h1><p className="muted">使用负责人分配的账号，管理自己创建的拼团。</p><form onSubmit={e => { e.preventDefault(); void run(async () => { const current = await api<Account>('auth/login', 'POST', { username, password }); setPassword(''); setAccount(current); await reload(); }); }}><Field label="账号" id="username"><input id="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></Field><Field label="密码" id="password"><input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field><button className="button primary full" disabled={busy}>{busy ? '登录中…' : '登录'}</button></form></section>
    : leader && !account?.leader ? <p className="notice">当前账号没有团长资格，请联系负责人。你仍可查看拼团广场。</p>
    : view === 'list' ? <>
      <div className="section-heading"><h1>{leader ? '我的拼团' : '拼团广场'}</h1>{leader && <button className="button primary" onClick={newDraft}>新建拼团</button>}</div><p className="muted">{leader ? '认真准备，把好物分享给同好。' : '发现好物，所有商品与规则来自实际发布记录。'}</p>
      {leader && <div className="group-tabs" aria-label="状态筛选">{['全部', '草稿', '进行中', '已结束'].map(item => <button key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>}
      {visibleList.map(record => <article className="group-card" key={record.id}><span className="tag">{statusText(record)}</span><h2>{record.title || '未命名拼团'}</h2>{record.status === 'published' && <p className="muted">成团门槛 {record.minimum} 件 · 截止 {record.deadline.replace('T', ' ')}</p>}<button className="button secondary full" disabled={busy} onClick={() => void open(record)}>{record.status === 'draft' ? '继续编辑' : '查看拼团'}</button></article>)}
      {!failure && visibleList.length === 0 && <div className="empty-state"><h2>{leader ? '暂无拼团' : '暂无已发布拼团'}</h2><p>{leader ? '从一个喜欢的商品开始吧。' : '团长发布后，好物会出现在这里。'}</p></div>}
    </> : view === 'edit' ? <>
      <div className="section-heading"><button className="text-button" disabled={!canAct} onClick={() => { leaveTarget.current = null; if (dirty) setDialog('leave'); else backToList(); }}>‹ 返回我的拼团</button><span className="tag">仅本人可见</span></div><h1>{group ? '编辑草稿' : '新建拼团'}</h1><p className="muted">将你的心意，一项项准备好。</p>
      <fieldset disabled={!canAct} className="editor">
        <section className="group-card"><h2>商品信息</h2><Field label="商品名称" id="title" error={errors.title}><input id="title" maxLength={40} value={input.title} {...invalid('title')} onChange={e => update('title', e.target.value)} /></Field><Field label="商品说明" id="description" error={errors.description}><textarea id="description" maxLength={2000} value={input.description} {...invalid('description')} onChange={e => update('description', e.target.value)} /></Field>
          <Field label="商品封面 · JPG / PNG，不超过 5MB" id="coverId" error={errors.coverId}><input id="coverId" type="file" accept="image/jpeg,image/png" {...invalid('coverId')} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void upload(file, false); }} />{uploading === 'coverId' && <progress aria-label="封面上传中" />}</Field>{input.coverId && <div className="upload-preview">
            <Image unoptimized width={76} height={76} src={`/api/pintuan/media/${input.coverId}`} alt="已上传商品封面" /><span>封面已上传</span></div>}
          <Field label={`详情图 · 最多 8 张，已上传 ${input.detailImageIds.length} 张`} id="detailImageIds" error={errors.detailImageIds}><input id="detailImageIds" type="file" accept="image/jpeg,image/png" disabled={input.detailImageIds.length >= 8} {...invalid('detailImageIds')} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void upload(file, true); }} />{uploading === 'detailImageIds' && <progress aria-label="详情图上传中" />}</Field>{input.detailImageIds.map((id, i) => <div className="upload-preview" key={id}>
            <Image unoptimized width={76} height={76} src={`/api/pintuan/media/${id}`} alt={`已上传详情图${i + 1}`} /><button className="text-button" onClick={() => update('detailImageIds', input.detailImageIds.filter(x => x !== id))}>移除详情图 {i + 1}</button></div>)}
        </section>
        <section className="group-card"><h2>商品规格</h2>{input.specs.map((spec, i) => <div className="spec-editor" key={i}><Field label={`规格 ${i + 1} 名称`} id={`specs.${i}.name`} error={errors[`specs.${i}.name`]}><input id={`specs.${i}.name`} maxLength={30} value={spec.name} {...invalid(`specs.${i}.name`)} onChange={e => update('specs', input.specs.map((s, n) => n === i ? { ...s, name: e.target.value } : s))} /></Field><div className="price-stock">{(['price', 'stock'] as const).map(key => <Field key={key} label={`规格 ${i + 1} ${key === 'price' ? '单价（元）' : '库存（件）'}`} id={`specs.${i}.${key}`} error={errors[`specs.${i}.${key}`]}><input id={`specs.${i}.${key}`} inputMode={key === 'price' ? 'decimal' : 'numeric'} value={spec[key]} {...invalid(`specs.${i}.${key}`)} onChange={e => update('specs', input.specs.map((s, n) => n === i ? { ...s, [key]: e.target.value } : s))} /></Field>)}</div>{input.specs.length > 1 && <button className="text-button" onClick={() => update('specs', input.specs.filter((_, n) => n !== i))}>移除规格 {i + 1}</button>}</div>)}{errors.specs && <p className="field-error">{errors.specs}</p>}<button className="button secondary full" disabled={input.specs.length >= 20} onClick={() => update('specs', [...input.specs, { name: '', price: '', stock: '' }])}>＋ 添加规格</button></section>
        <section className="group-card"><h2>成团与时间</h2><Field label="最低成团件数" id="minimum" error={errors.minimum}><input id="minimum" inputMode="numeric" value={input.minimum} {...invalid('minimum')} onChange={e => update('minimum', e.target.value)} /></Field>{(['deadline', 'shippingAt'] as const).map(key => <Field key={key} label={`${key === 'deadline' ? '截止时间' : '预计发货时间'}（北京时间）`} id={key} error={errors[key]}><input id={key} type="datetime-local" value={input[key]} {...invalid(key)} onChange={e => update(key, e.target.value)} /></Field>)}<p className="muted">预计发货时间应晚于截止时间。</p></section>
      </fieldset><p className="notice">发布后立即开售，商品、规格、价格、库存与时间均不可修改。</p>
      {group && <div className="editor-tools"><button className="text-button" disabled={!canAct} onClick={() => { if (window.confirm('重新加载将放弃本次未保存的编辑。继续？')) void open(group); }}>重新加载最新草稿</button><button className="text-button danger" disabled={!canAct} onClick={() => { if (window.confirm('删除这份草稿？')) void run(async () => { await api(`leader/groups/${group.id}`, 'DELETE', { revision: group.revision }); backToList(); }); }}>删除草稿</button></div>}
      <div className="group-footer"><button className="button secondary" disabled={!canAct} onClick={() => void run(async () => { await save(); })}>{busy ? '处理中…' : '保存草稿'}</button><button className="button primary" disabled={!canAct} onClick={() => void preview()}>预览发布</button></div>
    </> : group ? <>
      <p className={`notice ${view === 'preview' ? '' : 'success-notice'}`}>{view === 'preview' ? '发布前最后确认 · 此时尚未发布' : '拼团已发布 · 商品与规则已冻结'}</p><Product group={group} />
      {view === 'preview' ? <div className="group-footer"><button className="button secondary" disabled={!canAct} onClick={() => { setView('edit'); setMessage(''); }}>返回编辑</button><button className="button primary" disabled={!canAct} onClick={() => setDialog('publish')}>{busy ? '发布中…' : '确认发布'}</button></div> : <><p className="notice">当前状态：{statusText(group)}。{group.displayStatus === 'ended' ? '本期尚未接入截止结算，不代表已成团。' : '达到门槛也需等待截止，不提前结算。'}</p><div className="group-footer">{leader ? <><button className="button secondary" onClick={backToList}>返回我的拼团</button><Link className="button primary" href={`/groups/${group.id}`}>查看买家页面</Link></> : <Link className="button primary full" href="/groups">返回拼团广场</Link>}</div></>}
    </> : null}
    <dialog className="group-dialog" ref={dialogRef} onCancel={() => { leaveTarget.current = null; setDialog(null); }} aria-labelledby="dialog-title"><h2 id="dialog-title">{dialog === 'leave' ? '还有未保存的内容' : '确认发布这个拼团？'}</h2><p>{dialog === 'leave' ? '已保存的草稿会保留。请选择如何离开。' : '发布后立即开售，商品内容和交易规则将冻结，不能修改或撤团。'}</p>{dialog === 'leave' ? <><button className="button primary full" onClick={() => { leaveTarget.current = null; setDialog(null); }}>继续编辑</button><button className="button secondary full" disabled={busy} onClick={() => void run(async () => { const saved = await save(); if (saved) backToList(); else setDialog(null); })}>保存后离开</button><button className="text-button full" onClick={backToList}>放弃本次编辑</button></> : <><button className="button primary full" disabled={busy} onClick={() => { setDialog(null); void run(async () => { if (!group) return; const published = await api<GroupRecord>(`leader/groups/${group.id}/publish`, 'POST', { revision: group.revision, previewToken, confirmed: true }); setGroup(published); setView('detail'); setDirty(false); setMessage('拼团已发布。'); }); }}>确认立即发布</button><button className="button secondary full" onClick={() => setDialog(null)}>取消，继续预览</button></>}</dialog>
  </main>;
}
