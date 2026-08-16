import {
  Activity,
  ArrowRight,
  BatteryCharging,
  Box,
  Cable,
  Check,
  ChevronDown,
  CircleMinus,
  CloudCog,
  Cpu,
  Database,
  FileCheck2,
  Gauge,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const legalLinks = [
  ["/terms", "服务条款"],
  ["/privacy", "隐私政策"],
  ["/cookie-policy", "Cookie 政策"],
  ["/refund-policy", "退款与取消"],
  ["/data-rights", "数据权利"],
  ["/do-not-sell", "不出售或不分享"],
  ["/ai-disclaimer", "AI 免责声明"],
  ["/legal-supplement", "产品说明"],
] as const;

const legalRoutes: Record<string, { title: string; description: string }> = {
  terms: { title: "服务条款", description: "使用 STMWEB 时适用的服务条款。" },
  privacy: { title: "隐私政策", description: "STMWEB 及 SZLK 生态处理个人信息的方式。" },
  "cookie-policy": { title: "Cookie 与追踪政策", description: "Cookie、本地存储与类似技术的使用说明。" },
  "refund-policy": { title: "退款与取消政策", description: "购买、取消、退款与法定救济说明。" },
  "data-rights": { title: "数据权利说明", description: "个人数据访问、更正、删除和其他权利说明。" },
  "do-not-sell": { title: "不出售或不分享声明", description: "个人信息出售、分享和选择退出说明。" },
  "ai-disclaimer": { title: "AI 与娱乐用途免责声明", description: "AI 输出、限制和用户复核责任说明。" },
  "legal-supplement": { title: "STMWEB 产品法律补充说明", description: "STMWEB 特有的服务范围、数据边界和硬件操作风险说明。" },
};

function Brand() {
  return <a className="public-brand" href="/" aria-label="STMWEB 首页"><span><Activity size={19} /></span><strong>STMWEB</strong></a>;
}

function PublicHeader() {
  return (
    <header className="public-nav">
      <Brand />
      <nav aria-label="主要导航"><a href="/">首页</a><a href="/#workflow">工作方式</a><a href="/#capabilities">产品能力</a><a href="/plans">计划</a></nav>
      <a className="public-nav-cta" href="/workbench">进入工作台 <ArrowRight size={15} /></a>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer-brand"><Brand /><p>让每一次 STM32 调试都可连接、可理解、可追溯。</p><address>SZLK LTD<br />Company No. 16843016<br />Registered in England and Wales</address></div>
      <div className="public-footer-group"><strong>产品</strong><nav aria-label="产品信息"><a href="/">产品首页</a><a href="/workbench">硬件工作台</a><a href="/plans">产品计划</a></nav></div>
      <div className="public-footer-group legal"><strong>法律</strong><nav aria-label="法律信息">{legalLinks.map(([href, label]) => <a href={href} key={href}>{label}</a>)}</nav></div>
      <p>© {new Date().getUTCFullYear()} SZLK LTD. All rights reserved.</p>
    </footer>
  );
}

const workflow = [
  ["连接设备", "在浏览器系统选择器中授权附近硬件，不把本机设备权限交给远端服务器。"],
  ["识别能力", "读取固件能力描述和在线状态，确认姿态、电机、电池、摄像头与控制能力。"],
  ["生成工作台", "只展示这台设备当前真正提供的组件，保留用户选择的布局。"],
  ["记录调试", "把遥测、参数修改、控制动作和事件保存到同一次可导出的会话。"],
  ["构建固件", "连接自己的 x86 Linux Runner，在固定环境中生成并校验固件制品。"],
] as const;

const faqs = [
  ["STMWEB 是在线串口助手吗？", "不止于串口。它将浏览器连接、固件能力识别、动态调试组件、会话记录、固件版本和远端构建组织成同一条工作流。"],
  ["设备权限会交给服务器吗？", "不会。串口、USB、HID、蓝牙和局域网权限由你在当前电脑上主动授权；Runner 也不会获得这些浏览器硬件权限。"],
  ["工作台是否只支持某一款设备？", "不是。工作台按设备实际报告的能力生成，不会把页面写死在某个型号上；目前已在 DOT 平衡车主控上完成首套实物验证。"],
  ["现在可以无线烧录吗？", "可复现固件构建和制品管理已经可用；无线烧录仍需完成真实 Bootloader、硬件容量、传输恢复和安全条件验证后开放。"],
  ["我需要把编译机开放到公网吗？", "不需要。Runner 使用一次性命令完成配对，之后只通过出站 HTTPS 发送心跳、领取任务和回传结果。"],
] as const;

export function LandingPage() {
  usePageMetadata("STMWEB · 浏览器里的 STM32 硬件调试工作台", "连接 STM32 设备，自动识别固件能力，在一个浏览器工作台中完成运行态调试、工程记录与可复现固件构建。");
  const softwareSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "STMWEB",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web; Chromium desktop; x86_64 Linux Runner",
    description: "面向 STM32 智能硬件研发人员的浏览器调试、固件构建与工程记录工作台。",
    featureList: ["浏览器设备连接", "固件能力驱动工作台", "调试会话记录", "可复现固件构建", "用户授权 API"],
  };
  const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) };

  return (
    <main className="public-page marketing-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <PublicHeader />

      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="public-eyebrow"><span /> 浏览器里的 STM32 硬件调试工作台</p>
          <h1>连接设备。<br /><em>看懂每次变化。</em></h1>
          <p className="public-hero-lead">STMWEB 根据固件和在线硬件能力生成调试界面，把遥测、控制、事件、固件版本和构建结果收进同一次工程记录。</p>
          <div className="public-hero-actions"><a className="public-primary" href="/workbench">进入工作台 <ArrowRight size={17} /></a><a className="public-secondary" href="#workflow">查看完整流程</a></div>
          <p className="public-requirement"><ShieldCheck size={15} /> 设备权限只在你的浏览器中授权</p>
        </div>

        <div className="workbench-preview" aria-label="STMWEB 工作台预览">
          <div className="preview-bar"><span><Activity size={15} /> STMWEB</span><strong>平衡车主控 · 已连接</strong><i>正在记录</i></div>
          <div className="preview-layout">
            <aside><span className="active"><Gauge size={15} />调试台</span><span><Cpu size={15} />实体设备</span><span><Box size={15} />固件制品</span><span><Database size={15} />会话记录</span></aside>
            <div className="preview-canvas">
              <header><div><small>STM32F103CB</small><strong>DOT 运行态工作台</strong></div><span className="preview-action">正在记录</span></header>
              <div className="preview-metrics"><span><small>当前固件</small><strong>v1.1.0</strong></span><span><small>姿态</small><strong>-1.8°</strong></span><span><small>电池</small><strong>3.92 V</strong></span></div>
              <div className="preview-widgets">
                <article className="orientation-card"><span><Radio size={16} />姿态与陀螺仪</span><div><i /><b>-1.8°</b></div></article>
                <article className="chart-card"><span>实时遥测</span><div className="chart-lines"><i /><i /><i /></div></article>
                <article className="build-card"><span><CloudCog size={16} />固件构建</span><strong>编译完成</strong><small>ELF · HEX · BIN · MAP · LOG</small></article>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="proof-band" aria-label="产品事实">
        <div><Cable size={20} /><strong>一个连接入口</strong><span>Serial · USB · HID · BLE · LAN</span></div>
        <div><SlidersHorizontal size={20} /><strong>界面随能力生成</strong><span>不按设备型号写死页面</span></div>
        <div><FileCheck2 size={20} /><strong>真实构建已验证</strong><span>完整制品与 SHA-256 记录</span></div>
      </section>

      <section className="public-section workflow-section" id="workflow">
        <header className="public-section-heading"><p>一条连续的工程路径</p><h2>从靠近设备，到拿到构建结果。</h2><span>不用在多个工具之间反复复制设备信息、日志和固件版本，每一步都接着上一步继续。</span></header>
        <ol className="public-workflow">{workflow.map(([title, body], index) => <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
      </section>

      <section className="public-section capability-section" id="capabilities">
        <div className="capability-copy"><p className="public-eyebrow"><span /> 固件能力驱动</p><h2>不是为每块板子，<br />再做一套页面。</h2><p>设备报告自己有什么，STMWEB 再展示什么。能力离线、降级或未知时，工作台如实呈现，不猜测硬件状态。</p><a href="/workbench">打开工作台 <ArrowRight size={16} /></a></div>
        <div className="capability-grid">
          <article><Radio /><strong>姿态与曲线</strong><span>Pitch、Roll、陀螺仪和连续遥测</span></article>
          <article><BatteryCharging /><strong>电池与安全状态</strong><span>电压、阈值与设备在线状态</span></article>
          <article><SlidersHorizontal /><strong>参数与控制</strong><span>在同一会话中记录每次修改</span></article>
          <article><TerminalSquare /><strong>终端与事件</strong><span>连接、控制、构建和异常统一追溯</span></article>
        </div>
      </section>

      <section className="public-section ownership-section">
        <div className="ownership-diagram" aria-label="浏览器、STMWEB 与用户 Runner 的关系">
          <article><span>你的浏览器</span><strong>设备权限 · 实时控制</strong><small>在当前电脑上授权</small></article>
          <div><i /><b>同一工作区记录</b><i /></div>
          <article className="center"><span>STMWEB</span><strong>设备 · 会话 · 固件</strong><small>始终保持同一份工程记录</small></article>
          <div><i /><b>出站 HTTPS</b><i /></div>
          <article><span>你的 Runner</span><strong>源码 · 编译 · 制品</strong><small>无需开放入站端口</small></article>
        </div>
        <div className="ownership-copy"><p className="public-eyebrow"><span /> 权限与算力都由你掌握</p><h2>连接发生在本机，<br />构建发生在你的算力上。</h2><p>STMWEB 组织动作和结果，但不会取得你的浏览器硬件权限，也不会要求把节点 SSH、第三方平台身份或全局管理密钥交给产品。</p><ul><li><Check />每个外部工具都使用用户自己的授权连接</li><li><Check />调试会话、构建与制品共享同一业务记录</li><li><Check />授权可以缩小、轮换和撤销</li></ul></div>
      </section>

      <section className="public-section readiness-section">
        <header className="public-section-heading compact"><p>当前可用边界</p><h2>已验证的直接展示，仍在验证的明确说明。</h2></header>
        <div className="readiness-grid"><article><span>现在可用</span><h3>连接、调试记录与真实固件构建</h3><p>你可以在一个工作台中连接设备、查看能力、保存调试过程，并通过自己的 Runner 生成和校验固件制品。</p></article><article className="validation"><span>实物验证中</span><h3>安全无线烧录与升级恢复</h3><p>Bootloader、真实芯片容量、BLE GATT、断点恢复和重启版本确认完成实物验收后才会开放；在这些条件验证完成前，产品不会把它标记为可用。</p></article></div>
      </section>

      <section className="public-section plan-teaser">
        <div><p>简单的年度计划</p><h2>一套工作台，贯穿每次设备调试。</h2><span>价格与权益以产品计划页当前显示为准；硬件和编译节点始终由你选择。</span></div><a className="public-primary light" href="/plans">查看产品计划 <ArrowRight size={17} /></a>
      </section>

      <section className="public-section faq-section"><header className="public-section-heading compact"><p>常见问题</p><h2>开始之前，你可能还想确认这些。</h2></header><div className="public-faq">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div></section>

      <section className="public-final"><div><p>让下一次调试留下完整证据。</p><h2>打开浏览器，连接你的 STM32。</h2></div><a className="public-primary light" href="/workbench">进入工作台 <ArrowRight size={17} /></a></section>
      <PublicFooter />
    </main>
  );
}

type BillingPlan = {
  planId: string;
  label?: string;
  labelZh?: string;
  interval: "year";
  currency: "usd";
  amountCents: number;
  metadata?: {
    customerDisplay?: { zh?: { name?: string; billingSuffix?: string; offerLabel?: string; summary?: string } };
    freeTier?: { amountCents?: number; name?: { zh?: string }; summary?: { zh?: string } };
    features?: Array<{ key?: string; name?: { zh?: string }; free?: { zh?: string }; paid?: { zh?: string } }>;
    refundDays?: number;
    serviceBoundary?: { zh?: string };
  };
};

function isBillingPlan(value: unknown): value is BillingPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<BillingPlan>;
  const metadata = plan.metadata;
  return typeof plan.planId === "string" && plan.interval === "year" && plan.currency === "usd" && Number.isInteger(plan.amountCents) && Number(plan.amountCents) > 0
    && metadata?.freeTier?.amountCents === 0 && Boolean(metadata.freeTier.name?.zh) && Boolean(metadata.freeTier.summary?.zh)
    && Array.isArray(metadata.features) && metadata.features.length > 0
    && metadata.features.every((feature) => Boolean(feature.key && feature.name?.zh && feature.free?.zh && feature.paid?.zh));
}

export function PlansPage() {
  usePageMetadata("STMWEB 产品计划", "查看 STMWEB 年度计划、包含能力与服务边界。");
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  useEffect(() => {
    void fetch("/api/billing/catalog", { credentials: "same-origin" }).then(async (response) => {
      const body = await response.json() as { plans?: unknown[] };
      if (!response.ok) throw new Error("catalog unavailable");
      const plans = (body.plans || []).filter(isBillingPlan);
      if (plans.length !== 1) throw new Error("catalog ambiguous");
      setPlan(plans[0]);
      setStatus("ready");
    }).catch(() => setStatus("unavailable"));
  }, []);
  const display = plan?.metadata?.customerDisplay?.zh;
  const price = plan ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(plan.amountCents / 100) : "—";
  const free = plan?.metadata?.freeTier;
  const features = plan?.metadata?.features || [];

  return (
    <main className="public-page plans-page">
      <PublicHeader />
      <section className="plans-hero">
        <p className="public-eyebrow"><span /> 产品计划</p>
        <h1>先免费完成一次调试，<br />需要持续工程能力时再升级。</h1>
        <p>免费计划保留完整的浏览器连接与调试记录。Pro 面向需要自有 Runner 构建和外部工具自动化的持续研发工作。</p>
      </section>
      <section className="plan-card-wrap">
        {status === "loading" ? <div className="plan-loading" role="status">正在读取产品计划…</div> : status === "unavailable" || !plan || !free ? <div className="plan-unavailable" role="alert"><strong>计划暂时无法读取</strong><p>为避免展示错误权益，购买入口暂时关闭。免费工作台仍可正常进入。</p><a className="public-secondary" href="/workbench">进入免费工作台</a></div> : <>
          <div className="pricing-cards">
            <article className="pricing-card free"><span>免费</span><h2>{free.name?.zh}</h2><p>{free.summary?.zh}</p><div className="plan-price"><strong>$0</strong><small>长期可用</small></div><a className="public-secondary" href="/workbench">免费进入工作台</a></article>
            <article className="pricing-card pro"><span>{display?.offerLabel || "年度订阅"}</span><h2>{display?.name || plan.labelZh || plan.label}</h2><p>{display?.summary}</p><div className="plan-price"><strong>{price}</strong><small>{display?.billingSuffix || "/ 年"}</small></div><a className="public-primary" href={`/api/billing/checkout?planId=${encodeURIComponent(plan.planId)}`}>升级 Pro <ArrowRight size={17} /></a>{plan.metadata?.refundDays ? <small>{plan.metadata.refundDays} 天退款期</small> : null}</article>
          </div>
          <div className="plan-comparison">
            <h2>免费版和 Pro 的区别</h2>
            <div className="comparison-table" role="table" aria-label="STMWEB 免费版与 Pro 权限对比">
              <div className="comparison-row heading" role="row"><span role="columnheader">能力</span><strong role="columnheader">免费</strong><strong role="columnheader">Pro</strong></div>
              {features.map((feature) => <div className="comparison-row" role="row" key={feature.key}><span role="cell">{feature.name?.zh}</span><span role="cell">{feature.free?.zh === "不包含" ? <><CircleMinus size={16} />不包含</> : <><Check size={16} />{feature.free?.zh}</>}</span><span role="cell"><Check size={16} />{feature.paid?.zh}</span></div>)}
            </div>
          </div>
          <p className="plan-boundary"><ShieldCheck size={17} />{plan.metadata?.serviceBoundary?.zh}</p>
        </>}
      </section>
      <section className="plans-notes"><article><Wifi /><h3>免费先体验真实价值</h3><p>连接设备、生成工作台、保存工程记录，不用先付款。</p></article><article><CloudCog /><h3>为持续研发升级</h3><p>需要 Runner 构建和 API 自动化时，再进入 Pro。</p></article><article><ShieldCheck /><h3>拒绝隐藏限制</h3><p>免费和 Pro 的差异由同一产品计划明确展示并执行。</p></article></section>
      <PublicFooter />
    </main>
  );
}

type LegalSection = { id: string; title: string; body_markdown: string };
type LegalDocumentData = { title: string; effective_at: string; version: string; composition: Array<{ sections: LegalSection[] }> };

function SectionBody({ body }: { body: string }) {
  return body.split(/\n{2,}/).map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length && lines.every((line) => /^[-*]\s+/.test(line))) return <ul key={index}>{lines.map((line) => <li key={line}>{line.replace(/^[-*]\s+/, "")}</li>)}</ul>;
    if (lines.length && lines.every((line) => /^\d+[.)]\s+/.test(line))) return <ol key={index}>{lines.map((line) => <li key={line}>{line.replace(/^\d+[.)]\s+/, "")}</li>)}</ol>;
    return <p key={index}>{lines.join("\n")}</p>;
  });
}

function formatLegalDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

export function LegalPage({ slug }: { slug: string }) {
  const route = legalRoutes[slug];
  usePageMetadata(route?.title ? `${route.title} · STMWEB` : "法律文件 · STMWEB", route?.description || "STMWEB 法律与产品信息。");
  const [document, setDocument] = useState<LegalDocumentData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setError(false);
    void fetch(`/api/legal/${slug}`).then(async (response) => {
      const body = await response.json() as { success?: boolean; document?: LegalDocumentData; supplement?: LegalDocumentData };
      const value = body.document || body.supplement;
      if (!response.ok || body.success !== true || !value) throw new Error("legal unavailable");
      setDocument(value);
    }).catch(() => setError(true));
  }, [slug]);
  const hiddenIds = useMemo(() => new Set(["product_display_boundary", "professional_review"]), []);
  if (!route) return <NotFoundPage />;
  return <main className="public-page legal-page"><PublicHeader /><article className="legal-document"><header><p>STMWEB 法律文件</p><h1>{document?.title || route.title}</h1>{document ? <div><span>生效日期：{formatLegalDate(document.effective_at)}</span><span>版本：{document.version}</span></div> : null}</header>{error ? <div className="legal-unavailable" role="alert"><strong>法律文件暂时无法读取</strong><p>为避免展示过期内容，本页不会使用替代文本，请稍后重试。</p><button type="button" onClick={() => window.location.reload()}>重新加载</button></div> : !document ? <div className="legal-loading" role="status">正在读取当前生效版本…</div> : <><div className="legal-notice">以下内容为 SZLKLAWS 当前管理并发布的中文版本。重要服务或数据处理方式变化时，本页面会随受管版本更新。</div>{document.composition.flatMap((part) => part.sections).filter((section) => !hiddenIds.has(section.id)).map((section) => <section key={section.id}><h2>{section.title}</h2><SectionBody body={section.body_markdown} /></section>)}</>}</article><PublicFooter /></main>;
}

export function NotFoundPage() {
  usePageMetadata("页面未找到 · STMWEB", "请求的 STMWEB 页面不存在。");
  return <main className="public-page not-found-page"><PublicHeader /><section><span>404</span><h1>这里没有你要找的页面。</h1><p>返回产品首页，或者直接进入硬件调试工作台。</p><div><a className="public-secondary" href="/">返回首页</a><a className="public-primary" href="/workbench">进入工作台</a></div></section><PublicFooter /></main>;
}

function usePageMetadata(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    meta?.setAttribute("content", description);
  }, [description, title]);
}
