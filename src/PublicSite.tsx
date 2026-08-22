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
  Languages,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "./i18n.js";

const legalLinks = [
  ["/terms", "服务条款", "Terms of Service"],
  ["/privacy", "隐私政策", "Privacy Policy"],
  ["/cookie-policy", "Cookie 政策", "Cookie Policy"],
  ["/refund-policy", "退款与取消", "Refunds & Cancellations"],
  ["/data-rights", "数据权利", "Data Rights"],
  ["/do-not-sell", "不出售或不分享", "Do Not Sell or Share"],
  ["/ai-disclaimer", "AI 免责声明", "AI Disclaimer"],
  ["/legal-supplement", "产品说明", "Product Notice"],
] as const;

const legalRoutes: Record<string, { zh: { title: string; description: string }; en: { title: string; description: string } }> = {
  terms: { zh: { title: "服务条款", description: "使用 STMWEB 时适用的服务条款。" }, en: { title: "Terms of Service", description: "Terms that apply when you use STMWEB." } },
  privacy: { zh: { title: "隐私政策", description: "STMWEB 及 SZLK 生态处理个人信息的方式。" }, en: { title: "Privacy Policy", description: "How STMWEB and the SZLK ecosystem handle personal information." } },
  "cookie-policy": { zh: { title: "Cookie 与追踪政策", description: "Cookie、本地存储与类似技术的使用说明。" }, en: { title: "Cookie & Tracking Policy", description: "How cookies, local storage and similar technologies are used." } },
  "refund-policy": { zh: { title: "退款与取消政策", description: "购买、取消、退款与法定救济说明。" }, en: { title: "Refund & Cancellation Policy", description: "Purchases, cancellations, refunds and statutory remedies." } },
  "data-rights": { zh: { title: "数据权利说明", description: "个人数据访问、更正、删除和其他权利说明。" }, en: { title: "Data Rights Notice", description: "Access, correction, deletion and other personal data rights." } },
  "do-not-sell": { zh: { title: "不出售或不分享声明", description: "个人信息出售、分享和选择退出说明。" }, en: { title: "Do Not Sell or Share Notice", description: "Sale, sharing and opt-out rights for personal information." } },
  "ai-disclaimer": { zh: { title: "AI 与娱乐用途免责声明", description: "AI 输出、限制和用户复核责任说明。" }, en: { title: "AI Disclaimer", description: "AI outputs, limitations and the user's responsibility to review." } },
  "legal-supplement": { zh: { title: "STMWEB 产品法律补充说明", description: "STMWEB 特有的服务范围、数据边界和硬件操作风险说明。" }, en: { title: "STMWEB Product Legal Supplement", description: "STMWEB service scope, data boundaries and hardware operation risks." } },
};

function Brand() {
  const { isEnglish } = useLocale();
  return <a className="public-brand" href="/" aria-label={isEnglish ? "STMWEB home" : "STMWEB 首页"}><span><Activity size={19} /></span><strong translate="no">STMWEB</strong></a>;
}

function PublicHeader() {
  const { isEnglish, toggleLocale } = useLocale();
  return (
    <header className="public-nav">
      <Brand />
      <nav aria-label={isEnglish ? "Primary navigation" : "主要导航"}><a href="/">{isEnglish ? "Home" : "首页"}</a><a href="/#workflow">{isEnglish ? "How It Works" : "工作方式"}</a><a href="/#capabilities">{isEnglish ? "Capabilities" : "产品能力"}</a><a href="/plans">{isEnglish ? "Plans" : "计划"}</a></nav>
      <div className="public-nav-actions">
        <button
          aria-label={isEnglish ? "切换到中文" : "Switch to English"}
          className="public-language-toggle"
          onClick={toggleLocale}
          title={isEnglish ? "切换到中文" : "Switch to English"}
          type="button"
        >
          <Languages size={16} aria-hidden="true" />
          <span>{isEnglish ? "中文" : "EN"}</span>
        </button>
        <a className="public-nav-cta" href="/workbench">{isEnglish ? "Open Workbench" : "进入工作台"} <ArrowRight size={15} /></a>
      </div>
    </header>
  );
}

function PublicFooter() {
  const { isEnglish } = useLocale();
  return (
    <footer className="public-footer">
      <div className="public-footer-brand"><Brand /><p>{isEnglish ? "Make every STM32 debugging session connected, understandable and traceable." : "让每一次 STM32 调试都可连接、可理解、可追溯。"}</p><address><a href="https://szlk.ai" target="_blank" rel="noreferrer">SZLK LTD</a><br />Company No. 16843016<br />Registered in England and Wales</address></div>
      <div className="public-footer-group"><strong>{isEnglish ? "Product" : "产品"}</strong><nav aria-label={isEnglish ? "Product information" : "产品信息"}><a href="/">{isEnglish ? "Product Home" : "产品首页"}</a><a href="/workbench">{isEnglish ? "Hardware Workbench" : "硬件工作台"}</a><a href="/plans">{isEnglish ? "Product Plans" : "产品计划"}</a></nav></div>
      <div className="public-footer-group legal"><strong>{isEnglish ? "Legal" : "法律"}</strong><nav aria-label={isEnglish ? "Legal information" : "法律信息"}>{legalLinks.map(([href, zh, en]) => <a href={href} key={href}>{isEnglish ? en : zh}</a>)}</nav></div>
      <p>© {new Date().getUTCFullYear()} <a href="https://szlk.ai" target="_blank" rel="noreferrer">SZLK LTD</a>. All rights reserved.</p>
    </footer>
  );
}

const workflow = [
  ["连接设备", "在浏览器系统选择器中授权附近硬件，不把本机设备权限交给远端服务器。", "Connect a Device", "Authorise nearby hardware in the browser's system picker without giving device permissions to a remote server."],
  ["识别能力", "读取固件能力描述和在线状态，确认姿态、电机、电池、摄像头与控制能力。", "Detect Capabilities", "Read the firmware capability manifest and live status for sensors, motors, battery, camera and controls."],
  ["生成工作台", "只展示这台设备当前真正提供的组件，保留用户选择的布局。", "Build the Workbench", "Show only the components this device currently provides and retain your selected layout."],
  ["记录调试", "把遥测、参数修改、控制动作和事件保存到同一次可导出的会话。", "Record the Session", "Save telemetry, parameter changes, controls and events in one exportable session."],
  ["构建固件", "连接自己的 x86 Linux Runner，在固定环境中生成并校验固件制品。", "Build Firmware", "Connect your own x86 Linux Runner to generate and verify firmware artefacts in a fixed environment."],
] as const;

const faqs = [
  ["STMWEB 是在线串口助手吗？", "不止于串口。它将浏览器连接、固件能力识别、动态调试组件、会话记录、固件版本和远端构建组织成同一条工作流。", "Is STMWEB just an online serial terminal?", "No. It brings browser connectivity, firmware capability detection, dynamic debugging components, session history, firmware versions and remote builds into one workflow."],
  ["设备权限会交给服务器吗？", "不会。串口、USB、HID、蓝牙和局域网权限由你在当前电脑上主动授权；Runner 也不会获得这些浏览器硬件权限。", "Are device permissions sent to the server?", "No. You authorise serial, USB, HID, Bluetooth and local-network access on your current computer. The Runner never receives these browser hardware permissions."],
  ["工作台是否只支持某一款设备？", "不是。工作台按设备实际报告的能力生成，不会把页面写死在某个型号上；目前已在 DOT 平衡车主控上完成首套实物验证。", "Does the workbench support only one device?", "No. The workbench is generated from the capabilities a device reports rather than a hard-coded model. The first hardware validation was completed on the DOT balancing controller."],
  ["现在可以烧录固件吗？", "DOT V1 已验证长期 SWD 有线烧录和蓝牙应用升级；系统会检查芯片容量、分区、固件完整性和重启状态，其他硬件将在完成各自适配后开放。", "Can I flash firmware today?", "DOT V1 supports verified long-term SWD flashing and Bluetooth application updates. Chip capacity, partitions, firmware integrity and restart status are checked; other hardware will follow after its adapter is validated."],
  ["我需要把编译机开放到公网吗？", "不需要。Runner 使用一次性命令完成配对，之后只通过出站 HTTPS 发送心跳、领取任务和回传结果。", "Must I expose my build machine to the internet?", "No. The Runner pairs with a one-time command, then uses outbound HTTPS only for heartbeats, jobs and results."],
] as const;

export function LandingPage() {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  usePageMetadata(c("STMWEB · 浏览器里的 STM32 硬件调试工作台", "STMWEB · STM32 Hardware Debugging in Your Browser"), c("连接 STM32 设备，自动识别固件能力，在一个浏览器工作台中完成运行态调试、工程记录与可复现固件构建。", "Connect STM32 devices, detect firmware capabilities, debug live hardware, record engineering sessions and run reproducible firmware builds in one browser workbench."));
  const softwareSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "STMWEB",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web; Chromium desktop; x86_64 Linux Runner",
    description: c("面向 STM32 智能硬件研发人员的浏览器调试、固件构建与工程记录工作台。", "A browser workbench for STM32 device debugging, firmware builds and engineering records."),
    featureList: isEnglish ? ["Browser device connectivity", "Capability-driven workbench", "Debug session history", "Reproducible firmware builds", "User-authorised API"] : ["浏览器设备连接", "固件能力驱动工作台", "调试会话记录", "可复现固件构建", "用户授权 API"],
  };
  const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([zhQuestion, zhAnswer, enQuestion, enAnswer]) => ({ "@type": "Question", name: isEnglish ? enQuestion : zhQuestion, acceptedAnswer: { "@type": "Answer", text: isEnglish ? enAnswer : zhAnswer } })) };

  return (
    <main className="public-page marketing-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <PublicHeader />

      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="public-eyebrow"><span /> {c("浏览器里的 STM32 硬件调试工作台", "STM32 hardware debugging in your browser")}</p>
          <h1>{c("连接设备。", "Connect your device.")}<br /><em>{c("看懂每次变化。", "Understand every change.")}</em></h1>
          <p className="public-hero-lead">{c("STMWEB 根据固件和在线硬件能力生成调试界面，把遥测、控制、事件、固件版本和构建结果收进同一次工程记录。", "STMWEB builds the debugging interface from firmware and live hardware capabilities, keeping telemetry, controls, events, firmware versions and build results in one engineering record.")}</p>
          <div className="public-hero-actions"><a className="public-primary" href="/workbench">{c("进入工作台", "Open Workbench")} <ArrowRight size={17} /></a><a className="public-secondary" href="#workflow">{c("查看完整流程", "See the Full Workflow")}</a></div>
          <p className="public-requirement"><ShieldCheck size={15} /> {c("设备权限只在你的浏览器中授权", "Device permissions stay in your browser")}</p>
        </div>

        <div className="workbench-preview" aria-label={c("STMWEB 工作台预览", "STMWEB workbench preview")}>
          <div className="preview-bar"><span><Activity size={15} /> STMWEB</span><strong>{c("平衡车主控 · 已连接", "Balance controller · Connected")}</strong><i>{c("正在记录", "Recording")}</i></div>
          <div className="preview-layout">
            <aside><span className="active"><Gauge size={15} />{c("调试台", "Workbench")}</span><span><Cpu size={15} />{c("实体设备", "Devices")}</span><span><Box size={15} />{c("固件制品", "Firmware")}</span><span><Database size={15} />{c("会话记录", "Sessions")}</span></aside>
            <div className="preview-canvas">
              <header><div><small>STM32F103CB</small><strong>{c("DOT 运行态工作台", "DOT Runtime Workbench")}</strong></div><span className="preview-action">{c("正在记录", "Recording")}</span></header>
              <div className="preview-metrics"><span><small>{c("当前固件", "Firmware")}</small><strong>v1.1.0</strong></span><span><small>{c("姿态", "Pitch")}</small><strong>-1.8°</strong></span><span><small>{c("电池", "Battery")}</small><strong>3.92 V</strong></span></div>
              <div className="preview-widgets">
                <article className="orientation-card"><span><Radio size={16} />{c("姿态与陀螺仪", "Orientation & Gyroscope")}</span><div><i /><b>-1.8°</b></div></article>
                <article className="chart-card"><span>{c("实时遥测", "Live Telemetry")}</span><div className="chart-lines"><i /><i /><i /></div></article>
                <article className="build-card"><span><CloudCog size={16} />{c("固件构建", "Firmware Build")}</span><strong>{c("编译完成", "Build Complete")}</strong><small>ELF · HEX · BIN · MAP · LOG</small></article>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="proof-band" aria-label={c("产品事实", "Product facts")}>
        <div><Cable size={20} /><strong>{c("一个连接入口", "One Connection Entry")}</strong><span>Serial · USB · HID · BLE · LAN</span></div>
        <div><SlidersHorizontal size={20} /><strong>{c("界面随能力生成", "Capability-driven UI")}</strong><span>{c("不按设备型号写死页面", "Never hard-coded to a model")}</span></div>
        <div><FileCheck2 size={20} /><strong>{c("真实构建已验证", "Real Builds Verified")}</strong><span>{c("完整制品与 SHA-256 记录", "Complete artefacts & SHA-256 records")}</span></div>
      </section>

      <section className="public-section workflow-section" id="workflow">
        <header className="public-section-heading"><p>{c("一条连续的工程路径", "One Continuous Engineering Path")}</p><h2>{c("从靠近设备，到拿到构建结果。", "From a nearby device to a verified build.")}</h2><span>{c("不用在多个工具之间反复复制设备信息、日志和固件版本，每一步都接着上一步继续。", "Stop copying device details, logs and firmware versions between tools. Every step continues from the one before it.")}</span></header>
        <ol className="public-workflow">{workflow.map(([zhTitle, zhBody, enTitle, enBody], index) => <li key={zhTitle}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{isEnglish ? enTitle : zhTitle}</h3><p>{isEnglish ? enBody : zhBody}</p></div></li>)}</ol>
      </section>

      <section className="public-section capability-section" id="capabilities">
        <div className="capability-copy"><p className="public-eyebrow"><span /> {c("固件能力驱动", "Driven by Firmware Capabilities")}</p><h2>{c("不是为每块板子，", "One workbench,")}<br />{c("再做一套页面。", "not one page per board.")}</h2><p>{c("设备报告自己有什么，STMWEB 再展示什么。能力离线、降级或未知时，工作台如实呈现，不猜测硬件状态。", "The device reports what it can do, then STMWEB shows it. Offline, degraded or unknown capabilities are presented honestly without guessing hardware state.")}</p><a href="/workbench">{c("打开工作台", "Open Workbench")} <ArrowRight size={16} /></a></div>
        <div className="capability-grid">
          <article><Radio /><strong>{c("姿态与曲线", "Orientation & Charts")}</strong><span>{c("Pitch、Roll、陀螺仪和连续遥测", "Pitch, roll, gyroscope and continuous telemetry")}</span></article>
          <article><BatteryCharging /><strong>{c("电池与安全状态", "Battery & Safety")}</strong><span>{c("电压、阈值与设备在线状态", "Voltage, thresholds and device availability")}</span></article>
          <article><SlidersHorizontal /><strong>{c("参数与控制", "Parameters & Controls")}</strong><span>{c("在同一会话中记录每次修改", "Record every change in the same session")}</span></article>
          <article><TerminalSquare /><strong>{c("终端与事件", "Terminal & Events")}</strong><span>{c("连接、控制、构建和异常统一追溯", "Trace connections, controls, builds and errors together")}</span></article>
        </div>
      </section>

      <section className="public-section ownership-section">
        <div className="ownership-diagram" aria-label={c("浏览器、STMWEB 与用户 Runner 的关系", "Relationship between your browser, STMWEB and your Runner")}>
          <article><span>{c("你的浏览器", "Your Browser")}</span><strong>{c("设备权限 · 实时控制", "Device permissions · Live controls")}</strong><small>{c("在当前电脑上授权", "Authorised on this computer")}</small></article>
          <div><i /><b>{c("同一工作区记录", "One workspace record")}</b><i /></div>
          <article className="center"><span>STMWEB</span><strong>{c("设备 · 会话 · 固件", "Devices · Sessions · Firmware")}</strong><small>{c("始终保持同一份工程记录", "One continuous engineering record")}</small></article>
          <div><i /><b>{c("出站 HTTPS", "Outbound HTTPS")}</b><i /></div>
          <article><span>{c("你的 Runner", "Your Runner")}</span><strong>{c("源码 · 编译 · 制品", "Source · Builds · Artefacts")}</strong><small>{c("无需开放入站端口", "No inbound port required")}</small></article>
        </div>
        <div className="ownership-copy"><p className="public-eyebrow"><span /> {c("权限与算力都由你掌握", "Your permissions. Your compute.")}</p><h2>{c("连接发生在本机，", "Connect on your computer.")}<br />{c("构建发生在你的算力上。", "Build on your compute.")}</h2><p>{c("STMWEB 组织动作和结果，但不会取得你的浏览器硬件权限，也不会要求把节点 SSH、第三方平台身份或全局管理密钥交给产品。", "STMWEB organises actions and results without taking browser hardware permissions or asking for node SSH, third-party identities or global administration keys.")}</p><ul><li><Check />{c("每个外部工具都使用用户自己的授权连接", "Every external tool uses your own authorised connection")}</li><li><Check />{c("调试会话、构建与制品共享同一业务记录", "Sessions, builds and artefacts share one business record")}</li><li><Check />{c("授权可以缩小、轮换和撤销", "Authorisation can be scoped, rotated and revoked")}</li></ul></div>
      </section>

      <section className="public-section readiness-section">
        <header className="public-section-heading compact"><p>{c("当前可用边界", "Current Availability")}</p><h2>{c("已验证的直接展示，仍在验证的明确说明。", "Verified capabilities shown plainly. Ongoing validation stated clearly.")}</h2></header>
        <div className="readiness-grid"><article><span>{c("现在可用", "Available Now")}</span><h3>{c("连接、调试记录与真实固件构建", "Connectivity, Debug Records & Real Firmware Builds")}</h3><p>{c("你可以在一个工作台中连接设备、查看能力、保存调试过程，并通过自己的 Runner 生成和校验固件制品。", "Connect devices, inspect capabilities, save debugging sessions and generate verified firmware artefacts through your own Runner in one workbench.")}</p></article><article className="validation"><span>{c("DOT V1 已验证", "DOT V1 Verified")}</span><h3>{c("长期 SWD 有线烧录与蓝牙升级", "Long-term SWD Flashing & Bluetooth Updates")}</h3><p>{c("通过同一固件管理入口完成有线安装、更新、恢复和无线应用升级；平台会按真实芯片容量和固件清单自动匹配制品。", "Use one firmware workspace for wired installation, updates, recovery and wireless application upgrades. Artifacts are matched from the real chip capacity and firmware manifest.")}</p></article></div>
      </section>

      <section className="public-section plan-teaser">
        <div><p>{c("简单的年度计划", "Simple Annual Plans")}</p><h2>{c("一套工作台，贯穿每次设备调试。", "One workbench for every device session.")}</h2><span>{c("价格与权益以产品计划页当前显示为准；硬件和编译节点始终由你选择。", "Current pricing and entitlements are shown on the plans page. You always choose the hardware and build node.")}</span></div><a className="public-primary light" href="/plans">{c("查看产品计划", "View Product Plans")} <ArrowRight size={17} /></a>
      </section>

      <section className="public-section faq-section"><header className="public-section-heading compact"><p>{c("常见问题", "Frequently Asked Questions")}</p><h2>{c("开始之前，你可能还想确认这些。", "A few things worth confirming before you begin.")}</h2></header><div className="public-faq">{faqs.map(([zhQuestion, zhAnswer, enQuestion, enAnswer]) => <details key={zhQuestion}><summary>{isEnglish ? enQuestion : zhQuestion}<ChevronDown size={18} /></summary><p>{isEnglish ? enAnswer : zhAnswer}</p></details>)}</div></section>

      <section className="public-final"><div><p>{c("让下一次调试留下完整证据。", "Make the next debugging session fully traceable.")}</p><h2>{c("打开浏览器，连接你的 STM32。", "Open your browser. Connect your STM32.")}</h2></div><a className="public-primary light" href="/workbench">{c("进入工作台", "Open Workbench")} <ArrowRight size={17} /></a></section>
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
    customerDisplay?: { zh?: { name?: string; billingSuffix?: string; offerLabel?: string; summary?: string }; en?: { name?: string; billingSuffix?: string; offerLabel?: string; summary?: string } };
    freeTier?: { amountCents?: number; name?: { zh?: string; en?: string }; summary?: { zh?: string; en?: string } };
    features?: Array<{ key?: string; name?: { zh?: string; en?: string }; free?: { zh?: string; en?: string }; paid?: { zh?: string; en?: string } }>;
    refundDays?: number;
    serviceBoundary?: { zh?: string; en?: string };
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
  const { isEnglish, locale } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  usePageMetadata(c("STMWEB 产品计划", "STMWEB Product Plans"), c("查看 STMWEB 年度计划、包含能力与服务边界。", "Compare STMWEB annual plans, included capabilities and service boundaries."));
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  useEffect(() => {
    void fetch(`/api/billing/catalog?locale=${encodeURIComponent(locale)}`, { credentials: "same-origin" }).then(async (response) => {
      const body = await response.json() as { plans?: unknown[] };
      if (!response.ok) throw new Error("catalog unavailable");
      const plans = (body.plans || []).filter(isBillingPlan);
      if (plans.length !== 1) throw new Error("catalog ambiguous");
      setPlan(plans[0]);
      setStatus("ready");
    }).catch(() => setStatus("unavailable"));
  }, [locale]);
  const display = isEnglish ? plan?.metadata?.customerDisplay?.en || plan?.metadata?.customerDisplay?.zh : plan?.metadata?.customerDisplay?.zh;
  const price = plan ? new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(plan.amountCents / 100) : "—";
  const free = plan?.metadata?.freeTier;
  const features = plan?.metadata?.features || [];

  return (
    <main className="public-page plans-page">
      <PublicHeader />
      <section className="plans-hero">
        <p className="public-eyebrow"><span /> {c("产品计划", "Product Plans")}</p>
        <h1>{c("先免费完成一次调试，", "Complete your first session for free.")}<br />{c("需要持续工程能力时再升级。", "Upgrade when your workflow grows.")}</h1>
        <p>{c("免费计划保留完整的浏览器连接与调试记录。Pro 面向需要自有 Runner 构建和外部工具自动化的持续研发工作。", "The Free plan includes complete browser connectivity and debugging records. Pro adds your own Runner builds and external tool automation for ongoing development.")}</p>
      </section>
      <section className="plan-card-wrap">
        {status === "loading" ? <div className="plan-loading" role="status">{c("正在读取产品计划…", "Loading product plans…")}</div> : status === "unavailable" || !plan || !free ? <div className="plan-unavailable" role="alert"><strong>{c("计划暂时无法读取", "Plans are temporarily unavailable")}</strong><p>{c("为避免展示错误权益，购买入口暂时关闭。免费工作台仍可正常进入。", "Purchases are paused to avoid showing incorrect entitlements. The free workbench remains available.")}</p><a className="public-secondary" href="/workbench">{c("进入免费工作台", "Open Free Workbench")}</a></div> : <>
          <div className="pricing-cards">
            <article className="pricing-card free"><span>{c("免费", "Free")}</span><h2>{isEnglish ? free.name?.en || free.name?.zh : free.name?.zh}</h2><p>{isEnglish ? free.summary?.en || free.summary?.zh : free.summary?.zh}</p><div className="plan-price"><strong>$0</strong><small>{c("长期可用", "Available indefinitely")}</small></div><a className="public-secondary" href="/workbench">{c("免费进入工作台", "Open Free Workbench")}</a></article>
            <article className="pricing-card pro"><span>{display?.offerLabel || c("年度订阅", "Annual subscription")}</span><h2>{display?.name || plan.labelZh || plan.label}</h2><p>{display?.summary}</p><div className="plan-price"><strong>{price}</strong><small>{display?.billingSuffix || c("/ 年", "/ year")}</small></div><a className="public-primary" href={`/api/billing/checkout?planId=${encodeURIComponent(plan.planId)}`}>{c("升级 Pro", "Upgrade to Pro")} <ArrowRight size={17} /></a>{plan.metadata?.refundDays ? <small>{c(`${plan.metadata.refundDays} 天退款期`, `${plan.metadata.refundDays}-day refund period`)}</small> : null}</article>
          </div>
          <div className="plan-comparison">
            <h2>{c("免费版和 Pro 的区别", "Free vs Pro")}</h2>
            <div className="comparison-table" role="table" aria-label={c("STMWEB 免费版与 Pro 权限对比", "STMWEB Free and Pro comparison")}>
              <div className="comparison-row heading" role="row"><span role="columnheader">{c("能力", "Capability")}</span><strong role="columnheader">{c("免费", "Free")}</strong><strong role="columnheader">Pro</strong></div>
              {features.map((feature) => { const freeLabel = isEnglish ? feature.free?.en || feature.free?.zh : feature.free?.zh; return <div className="comparison-row" role="row" key={feature.key}><span role="cell">{isEnglish ? feature.name?.en || feature.name?.zh : feature.name?.zh}</span><span role="cell">{feature.free?.zh === "不包含" ? <><CircleMinus size={16} />{c("不包含", "Not included")}</> : <><Check size={16} />{freeLabel}</>}</span><span role="cell"><Check size={16} />{isEnglish ? feature.paid?.en || feature.paid?.zh : feature.paid?.zh}</span></div>; })}
            </div>
          </div>
          <p className="plan-boundary"><ShieldCheck size={17} />{isEnglish ? plan.metadata?.serviceBoundary?.en || plan.metadata?.serviceBoundary?.zh : plan.metadata?.serviceBoundary?.zh}</p>
        </>}
      </section>
      <section className="plans-notes"><article><Wifi /><h3>{c("免费先体验真实价值", "Experience Real Value for Free")}</h3><p>{c("连接设备、生成工作台、保存工程记录，不用先付款。", "Connect a device, generate a workbench and save engineering records before paying.")}</p></article><article><CloudCog /><h3>{c("为持续研发升级", "Upgrade for Ongoing Development")}</h3><p>{c("需要 Runner 构建和 API 自动化时，再进入 Pro。", "Move to Pro when you need Runner builds and API automation.")}</p></article><article><ShieldCheck /><h3>{c("拒绝隐藏限制", "No Hidden Limits")}</h3><p>{c("免费和 Pro 的差异由同一产品计划明确展示并执行。", "Free and Pro differences are shown and enforced by the same product plan.")}</p></article></section>
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

function formatLegalDate(value: string, locale: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

export function LegalPage({ slug }: { slug: string }) {
  const { isEnglish, locale, legalLocale } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const routeGroup = legalRoutes[slug];
  const route = routeGroup ? (isEnglish ? routeGroup.en : routeGroup.zh) : undefined;
  usePageMetadata(route?.title ? `${route.title} · STMWEB` : c("法律文件 · STMWEB", "Legal Documents · STMWEB"), route?.description || c("STMWEB 法律与产品信息。", "STMWEB legal and product information."));
  const [document, setDocument] = useState<LegalDocumentData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setError(false);
    void fetch(`/api/legal/${slug}?locale=${encodeURIComponent(legalLocale)}`).then(async (response) => {
      const body = await response.json() as { success?: boolean; document?: LegalDocumentData; supplement?: LegalDocumentData };
      const value = body.document || body.supplement;
      if (!response.ok || body.success !== true || !value) throw new Error("legal unavailable");
      setDocument(value);
    }).catch(() => setError(true));
  }, [legalLocale, slug]);
  const hiddenIds = useMemo(() => new Set(["product_display_boundary", "professional_review"]), []);
  if (!route) return <NotFoundPage />;
  return <main className="public-page legal-page"><PublicHeader /><article className="legal-document"><header><p>{c("STMWEB 法律文件", "STMWEB Legal Document")}</p><h1>{document?.title || route.title}</h1>{document ? <div><span>{c("生效日期：", "Effective date: ")}{formatLegalDate(document.effective_at, locale)}</span><span>{c("版本：", "Version: ")}{document.version}</span></div> : null}</header>{error ? <div className="legal-unavailable" role="alert"><strong>{c("法律文件暂时无法读取", "This legal document is temporarily unavailable")}</strong><p>{c("为避免展示过期内容，本页不会使用替代文本，请稍后重试。", "To avoid showing outdated terms, this page does not use fallback text. Please try again shortly.")}</p><button type="button" onClick={() => window.location.reload()}>{c("重新加载", "Reload")}</button></div> : !document ? <div className="legal-loading" role="status">{c("正在读取当前生效版本…", "Loading the current effective version…")}</div> : <><div className="legal-notice">{c("以下内容为 SZLKLAWS 当前管理并发布的中文版本。重要服务或数据处理方式变化时，本页面会随受管版本更新。", "The content below is the current English version managed and published by SZLKLAWS. This page updates with the governed version when material service or data-processing terms change.")}</div>{document.composition.flatMap((part) => part.sections).filter((section) => !hiddenIds.has(section.id)).map((section) => <section key={section.id}><h2>{section.title}</h2><SectionBody body={section.body_markdown} /></section>)}</>}</article><PublicFooter /></main>;
}

export function NotFoundPage() {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  usePageMetadata(c("页面未找到 · STMWEB", "Page Not Found · STMWEB"), c("请求的 STMWEB 页面不存在。", "The requested STMWEB page does not exist."));
  return <main className="public-page not-found-page"><PublicHeader /><section><span>404</span><h1>{c("这里没有你要找的页面。", "That page isn't here.")}</h1><p>{c("返回产品首页，或者直接进入硬件调试工作台。", "Return to the product home or open the hardware workbench.")}</p><div><a className="public-secondary" href="/">{c("返回首页", "Return Home")}</a><a className="public-primary" href="/workbench">{c("进入工作台", "Open Workbench")}</a></div></section><PublicFooter /></main>;
}

function usePageMetadata(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    meta?.setAttribute("content", description);
  }, [description, title]);
}
