export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join('/');
  if (!/^(auth\/(login|logout|me)|groups(\/[a-f0-9-]{36})?|leader\/groups(\/[a-f0-9-]{36}(\/(preview|publish))?)?|media(\/[a-f0-9-]{36})?)$/.test(route)) {
    return Response.json({ message: '页面不存在，请返回重试。' }, { status: 404 });
  }
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    let sameOrigin = false;
    try {
      const source = origin ? new URL(origin) : null;
      // Next 的内部请求 URL 可能使用 localhost，浏览器 Origin 应匹配实际 Host。
      sameOrigin = !!source && source.origin === origin && source.host === host?.toLowerCase() && source.protocol === new URL(request.url).protocol;
    } catch { /* Invalid origins remain rejected. */ }
    if (!sameOrigin) return Response.json({ message: '请从当前页面提交操作。' }, { status: 403 });
  }
  try {
    const headers = new Headers({ 'x-pintuan-request': '1' });
    for (const name of ['cookie', 'content-type']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
    let body: Uint8Array | undefined;
    if (request.method !== 'GET' && request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      const limit = route === 'media' ? 5 * 1024 * 1024 + 65536 : 65536;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > limit) { await reader.cancel(); return Response.json({ message: '提交内容过大，图片请限制在 5MB 内。' }, { status: 413 }); }
        chunks.push(part.value);
      }
      body = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    }
    const api = process.env.SERVER_API_URL ?? 'http://127.0.0.1:3001/api';
    const upstream = await fetch(`${api.replace(/\/+$/, '')}/pintuan/${route}`, {
      method: request.method, headers, body: body as BodyInit | undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    const responseHeaders = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const type = upstream.headers.get('content-type'); if (type) responseHeaders.set('content-type', type);
    const cookie = upstream.headers.get('set-cookie');
    if (cookie) responseHeaders.set('set-cookie', new URL(request.url).protocol === 'https:' && !cookie.includes('Secure') ? `${cookie}; Secure` : cookie);
    if (upstream.status === 413) return Response.json({ message: '请上传不超过 5MB 的 JPG / PNG 图片。' }, { status: 413 });
    if (upstream.status >= 500) return Response.json({ message: '服务暂时不可用，请保留当前内容并重试。' }, { status: 503 });
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ message: '暂时无法连接服务，请启动后端或稍后重试。已填内容会保留。' }, { status: 503 });
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
