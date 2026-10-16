import Link from 'next/link';
import { APP_NAME } from '@pintuan/contracts';

export default function HomePage() {
  return (
    <main className="workspace">
      <header className="topbar">
        <Link className="brand" href="/" aria-label={`${APP_NAME}首页`}>
          <span className="brand-mark" aria-hidden="true">哇</span>
          {APP_NAME}
        </Link>
        <span className="tag">学员实战模板</span>
      </header>

      <section className="hero" aria-labelledby="welcome-title">
        <p className="eyebrow">从原型开始，把想法做成产品</p>
        <h1 id="welcome-title">你的拼团项目，<br />从这里开始。</h1>
        <p className="intro">工程已经可以运行。接下来，跟着课程把页面、接口和数据一步步接起来。团长可创建、保存并发布拼团。</p>
        <div className="actions">
          <Link className="button primary" href="/leader">我的拼团</Link>
          <Link className="button secondary" href="/groups">拼团广场</Link>
          <a className="button primary" href="/prototype/index.html">打开可点击原型 <span aria-hidden="true">↗</span></a>
          <a className="button secondary" href="/api/server-health">查看后端健康检查</a>
        </div>
        <p className="hint">原型展示交互与视觉设计，可作为开发时的参考。</p>
      </section>

      <section className="learning-path" aria-label="开发路线">
        <article className="stage">
          <span className="stage-number">01</span>
          <p className="stage-label">第一阶段 · 现在开始</p>
          <h2>Next.js 前端</h2>
          <p>在 App Router 中搭建页面，学习组件、路由与服务端请求。共享包已经接入，首页名称就来自 contracts。</p>
          <span className="stage-status">前端工程已就绪</span>
        </article>
        <article className="stage">
          <span className="stage-number">02</span>
          <p className="stage-label">第二阶段 · 按课程接入</p>
          <h2>NestJS 后端</h2>
          <p>开启后端后，用健康检查走通 Next.js 到 NestJS 的请求，再逐步实现业务接口。只做前端练习时可以暂不开启。</p>
          <span className="stage-status muted">后端按需启动</span>
        </article>
      </section>

      <footer>已接入团长创建与发布；下单、支付与履约将在后续阶段完成。</footer>
    </main>
  );
}
