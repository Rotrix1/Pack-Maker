import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CircleDot,
  Code2,
  Download,
  FileArchive,
  FolderSearch,
  HeartHandshake,
  Menu,
  MonitorDown,
  Music4,
  Sparkles,
  X,
} from 'lucide-react'

type IconComponent = typeof FolderSearch

type ScreenshotProps = {
  src: string
  alt: string
  className?: string
  priority?: boolean
  focus?: 'library' | 'pack'
}

type FeatureSectionProps = {
  eyebrow: string
  title: string
  description: string
  bullets: string[]
  screenshot: ScreenshotProps
  reverse?: boolean
  children?: ReactNode
}

const githubUrl = 'https://github.com/Rotrix1/Pack-Maker'
const releaseUrl = `${githubUrl}/releases/latest`

const navigation = [
  { label: 'Features', href: '#features' },
  { label: 'Dan Creator', href: '#dan-creator' },
  { label: 'Open Source', href: '#open-source' },
  { label: 'Credits', href: '#credits' },
]

const trustItems: { icon: IconComponent; title: string; text: string }[] = [
  { icon: FolderSearch, title: 'Local library', text: 'Your chosen Songs folder' },
  { icon: CircleDot, title: 'Non-destructive', text: 'Sources stay untouched' },
  { icon: FileArchive, title: '.osz export', text: 'Fresh, importable packs' },
  { icon: Code2, title: 'Open source', text: 'Built in the open' },
  { icon: MonitorDown, title: 'Windows release', text: 'Ready to download' },
]

const workflow = [
  { number: '01', title: 'Scan', copy: 'Select your osu! Songs directory.' },
  { number: '02', title: 'Choose', copy: 'Pick the exact difficulties you want.' },
  { number: '03', title: 'Customise', copy: 'Tune maps, trainer settings and backgrounds.' },
  { number: '04', title: 'Export', copy: 'Generate a fresh .osz for osu!.' },
]

const credits = [
  { name: 'Rotrix', role: 'Created by', href: 'https://osu.ppy.sh/users/31245051' },
  { name: 'Pofanek', role: 'Contributed by', href: 'https://osu.ppy.sh/users/18185878' },
]

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true)
        observer.disconnect()
      }
    }, { threshold: 0.12 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className={`reveal ${visible ? 'is-visible' : ''} ${className}`}>{children}</div>
}

function Brand() {
  return (
    <a href="#top" className="group inline-flex items-center gap-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-300">
      <img src="/pack-studio-logo.png" alt="osu! Pack Studio" className="h-9 w-9 object-contain transition-transform duration-300 group-hover:scale-105" />
      <span className="text-[0.98rem] font-extrabold tracking-tight text-white">osu! Pack Studio</span>
    </a>
  )
}

function ButtonLink({ href, children, primary = false, className = '' }: { href: string; children: ReactNode; primary?: boolean; className?: string }) {
  return (
    <a
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-300 ${primary
        ? 'bg-gradient-to-r from-pink-500 to-fuchsia-500 text-white shadow-[0_8px_30px_rgba(236,72,153,0.28)] hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgba(236,72,153,0.38)]'
        : 'border border-white/12 bg-white/[0.045] text-slate-100 hover:-translate-y-0.5 hover:border-cyan-300/45 hover:bg-cyan-300/10'
      } ${className}`}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noreferrer' : undefined}
    >
      {children}
    </a>
  )
}

function Navbar() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#090a12]/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-[4.6rem] w-full max-w-[84rem] items-center justify-between gap-6 px-5 lg:px-8" aria-label="Main navigation">
        <Brand />
        <div className="hidden items-center gap-7 lg:flex">
          {navigation.map((item) => <a key={item.href} href={item.href} className="text-sm font-semibold text-slate-300 transition hover:text-cyan-200 focus:outline-none focus:text-cyan-200">{item.label}</a>)}
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <ButtonLink href={githubUrl}><Code2 size={17} aria-hidden="true" />GitHub</ButtonLink>
          <ButtonLink href={releaseUrl} primary><Download size={17} aria-hidden="true" />Download for Windows</ButtonLink>
        </div>
        <button type="button" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-white lg:hidden">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>
      {open && <div className="border-t border-white/[0.07] bg-[#0d0e19] px-5 py-4 lg:hidden">
        <div className="mx-auto flex max-w-[84rem] flex-col gap-3">
          {navigation.map((item) => <a key={item.href} onClick={() => setOpen(false)} href={item.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5">{item.label}</a>)}
          <div className="mt-2 flex gap-2 border-t border-white/10 pt-4"><ButtonLink href={githubUrl} className="flex-1"><Code2 size={17} />GitHub</ButtonLink><ButtonLink href={releaseUrl} primary className="flex-1"><Download size={17} />Download</ButtonLink></div>
        </div>
      </div>}
    </header>
  )
}

function ProductScreenshot({ src, alt, className = '', priority = false, focus }: ScreenshotProps) {
  const focusImageClass = focus === 'library'
    ? 'h-full w-full origin-left-top scale-[1.55] object-cover'
    : focus === 'pack'
      ? 'h-full w-full origin-[40%_20%] scale-[1.38] -translate-x-[10%] object-cover'
      : 'h-auto w-full object-cover'

  return (
    <div className={`screenshot-frame group relative overflow-hidden rounded-[1.4rem] border border-white/12 bg-[#070810] shadow-[0_30px_90px_rgba(0,0,0,0.48)] ${className}`}>
      <a href={src} target="_blank" rel="noreferrer" aria-label={`Open full-size preview: ${alt}`} className={`block cursor-zoom-in overflow-hidden ${focus ? 'aspect-[16/10]' : ''}`}>
        <img src={src} alt={alt} loading={priority ? 'eager' : 'lazy'} className={`block transition duration-500 group-hover:scale-[1.018] ${focusImageClass}`} />
      </a>
    </div>
  )
}

function FeatureSection({ eyebrow, title, description, bullets, screenshot, reverse = false, children }: FeatureSectionProps) {
  return (
    <Reveal className="py-14 lg:py-20">
      <section className={`grid items-center gap-10 lg:grid-cols-2 lg:gap-16 ${reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">{title}</h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">{description}</p>
          <ul className="mt-7 grid gap-3 sm:grid-cols-2">
            {bullets.map((bullet) => <li key={bullet} className="flex items-start gap-2.5 text-sm leading-5 text-slate-200"><Check size={16} className="mt-0.5 shrink-0 text-cyan-300" aria-hidden="true" />{bullet}</li>)}
          </ul>
          {children}
        </div>
        <ProductScreenshot {...screenshot} />
      </section>
    </Reveal>
  )
}

function App() {
  return (
    <div id="top" className="min-h-screen overflow-hidden bg-[#090a12] text-slate-100 selection:bg-pink-400/35">
      <Navbar />
      <main>
        <section className="relative isolate">
          <div className="hero-grid absolute inset-0 -z-10 opacity-40" />
          <div className="absolute -left-24 top-16 -z-10 h-80 w-80 rounded-full bg-pink-500/15 blur-3xl" /><div className="absolute right-0 top-32 -z-10 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="mx-auto grid max-w-[84rem] items-center gap-12 px-5 pb-16 pt-16 sm:pb-24 sm:pt-24 lg:grid-cols-[0.86fr_1.14fr] lg:gap-14 lg:px-8">
            <Reveal>
              <div className="inline-flex items-center gap-2 rounded-full border border-pink-300/25 bg-pink-400/10 px-3 py-1.5 text-xs font-extrabold tracking-[0.12em] text-pink-100"><Sparkles size={14} />FREE AND OPEN SOURCE</div>
              <h1 className="mt-6 max-w-2xl text-4xl font-black leading-[1.02] tracking-[-0.055em] text-white sm:text-5xl lg:text-[3.7rem]">Create custom osu!mania packs in one desktop app.</h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">Scan your local osu! library, build packs, tune rate and pitch, configure training maps, edit backgrounds and create Dan marathons—without touching your original beatmaps.</p>
              <div className="mt-8 flex flex-wrap gap-3"><ButtonLink href={releaseUrl} primary><Download size={18} />Download for Windows</ButtonLink><ButtonLink href={githubUrl}><Code2 size={18} />View on GitHub</ButtonLink></div>
              <div className="mt-7 flex items-center gap-3 text-sm text-slate-400"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-300/10 text-cyan-300"><Check size={15} /></span><span><strong className="font-bold text-slate-200">Your original beatmaps stay untouched.</strong> Every export is new.</span></div>
              <p className="mt-4 text-xs font-medium text-slate-500">Windows release available now. Linux and macOS can build from source.</p>
            </Reveal>
            <Reveal className="relative lg:pt-3"><div className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-gradient-to-br from-pink-500/20 via-transparent to-cyan-400/15 blur-2xl" /><ProductScreenshot src="/screenshots/pack-studio.png" alt="osu! Pack Studio showing a local map library, selected maps and trainer controls" priority /></Reveal>
          </div>
        </section>

        <section className="border-y border-white/[0.07] bg-white/[0.018]">
          <div className="mx-auto grid max-w-[84rem] divide-y divide-white/[0.07] px-5 py-2 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5 lg:px-8">
            {trustItems.map(({ icon: Icon, title, text }) => <div key={title} className="flex items-center gap-3 px-3 py-4 lg:px-4"><Icon size={19} className="shrink-0 text-cyan-300" /><div><p className="text-sm font-bold text-white">{title}</p><p className="text-xs text-slate-500">{text}</p></div></div>)}
          </div>
        </section>

        <div id="features" className="mx-auto max-w-[84rem] px-5 lg:px-8">
          <FeatureSection eyebrow="LOCAL LIBRARY" title="Your osu!mania library, ready immediately." description="Choose your osu! Songs folder once. Pack Studio keeps a lightweight cache in AppData so familiar beatmaps are there as soon as you return, then checks your library progressively in the background." bullets={['Browse beatmapsets and exact difficulties', 'Search through a local, mania-only library', 'Persistent cache and background refresh', 'Original .osu files are never modified']} screenshot={{ src: '/screenshots/library.png', alt: 'Pack Studio local map library' }} />
          <FeatureSection eyebrow="PACK STUDIO" title="Build a pack exactly how you want it." description="Collect individual difficulties from multiple beatmapsets, name the pack, tune each chart and export a new ready-to-import archive. Source maps are never modified." bullets={['Per-map rate, pitch and audio preview', 'Trainer settings per selected difficulty', 'Named projects and post-export autosaves', 'Generate a fresh importable .osz']} screenshot={{ src: '/screenshots/pack-studio.png', alt: 'Pack Studio with selected maps, rate controls and trainer presets' }} reverse />
          <FeatureSection eyebrow="BACKGROUND EDITOR" title="Make every background yours." description="Build a visual setup that stays true to the generated map. Use effect presets, then layer your own images directly over the preview with practical positioning controls." bullets={['Effects and colour presets', 'Multiple image overlay layers', 'Drag, opacity and scale controls', 'Apply one setup to every background in a pack']} screenshot={{ src: '/screenshots/background-editor.png', alt: 'Background Editor with effects and multiple image layers' }}><div className="mt-8 flex flex-wrap gap-2">{['Effects', 'Image layers', 'Live preview'].map((item) => <span key={item} className="rounded-lg border border-pink-300/18 bg-pink-300/[0.06] px-3 py-1.5 text-xs font-bold text-pink-100">{item}</span>)}</div></FeatureSection>
        </div>

        <section id="dan-creator" className="relative border-y border-white/[0.07] bg-[#0d0e19] py-16 lg:py-24">
          <div className="absolute inset-0 -z-0 opacity-30 [background:radial-gradient(circle_at_10%_50%,rgba(236,72,153,.18),transparent_28%),radial-gradient(circle_at_90%_40%,rgba(34,211,238,.12),transparent_26%)]" />
          <Reveal className="relative z-10 mx-auto max-w-[84rem] px-5 lg:px-8"><section className="grid items-center gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16"><div><p className="eyebrow">DAN CREATOR</p><h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">Turn multiple maps into one marathon.</h2><p className="mt-5 max-w-xl text-base leading-7 text-slate-300">Choose up to four osu!mania difficulties, arrange the sequence, set one consistent break duration and export a new playable Dan map. It merges charts and audio, builds a collage background and keeps every part in sync.</p><div className="mt-7 grid gap-3 sm:grid-cols-2">{['Up to four selected difficulties', 'Consistent breaks and optional intro trim', 'Synced fade-ins and collage background', '4K · HP 8.5 · OD 9 defaults'].map((item) => <p key={item} className="flex gap-2.5 text-sm text-slate-200"><Check size={16} className="mt-0.5 shrink-0 text-pink-300" />{item}</p>)}</div></div><div className="relative"><ProductScreenshot src="/screenshots/dan-creator.png" alt="Dan Creator configuration screen" /><div className="relative -mt-8 ml-auto mr-5 w-[58%] rotate-[1deg] sm:-mt-14 sm:w-[54%]"><ProductScreenshot src="/screenshots/dan-collage.png" alt="Dan Creator marathon collage preview" /></div></div></section></Reveal>
        </section>

        <div className="mx-auto max-w-[84rem] px-5 lg:px-8"><FeatureSection eyebrow="PROJECTS & RELIABILITY" title="Pick up where you left off." description="Projects remember the details that matter: selected maps, their rates and pitches, background edits and app settings. Generation also creates an autosave, while the output path starts in the user’s Downloads folder." bullets={['Named manual saves and separate autosaves', 'Window dimensions and settings remembered', 'Selected maps and edits persist together', 'Bundled FFmpeg in the Windows release']} screenshot={{ src: '/screenshots/projects.png', alt: 'osu! Pack Studio projects panel' }} reverse /></div>

        <section className="mx-auto max-w-[84rem] px-5 py-14 lg:px-8 lg:py-20"><Reveal><div className="rounded-[1.5rem] border border-white/[0.09] bg-white/[0.025] px-5 py-8 sm:px-9 sm:py-10"><div className="max-w-2xl"><p className="eyebrow">WORKFLOW</p><h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">From your osu! library to a finished pack.</h2></div><div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">{workflow.map((step, index) => <div key={step.number} className="relative pr-5 lg:pr-9">{index < workflow.length - 1 && <span className="absolute left-[2.2rem] right-0 top-5 hidden h-px bg-gradient-to-r from-cyan-300/55 to-white/10 lg:block" />}<span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-xs font-black text-cyan-200">{step.number}</span><h3 className="mt-4 text-lg font-extrabold text-white">{step.title}</h3><p className="mt-1.5 text-sm leading-6 text-slate-400">{step.copy}</p></div>)}</div></div></Reveal></section>

        <section id="open-source" className="border-y border-cyan-200/10 bg-[#0b1320] py-16 lg:py-20"><Reveal className="mx-auto grid max-w-[84rem] items-center gap-10 px-5 lg:grid-cols-[1.1fr_.9fr] lg:px-8"><div><p className="eyebrow">OPEN SOURCE</p><h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">Built openly for the osu!mania community.</h2><p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">Inspect the code, report a bug, suggest a feature or help shape the next release. Windows builds are available as releases; Linux and macOS users can build the application from source.</p><div className="mt-8 flex flex-wrap gap-3"><ButtonLink href={githubUrl} primary><Code2 size={18} />Open GitHub repository</ButtonLink><ButtonLink href={`${githubUrl}/issues`}><HeartHandshake size={18} />Report an issue</ButtonLink><ButtonLink href={`${githubUrl}#building`}><BookOpen size={18} />Read the build guide</ButtonLink></div></div><div className="rounded-[1.35rem] border border-cyan-200/15 bg-[#080d16] p-5 shadow-[0_20px_70px_rgba(0,0,0,.32)]"><div className="flex items-center justify-between border-b border-white/[0.07] pb-4"><span className="inline-flex items-center gap-2 text-sm font-bold text-white"><Code2 size={18} className="text-cyan-300" />Rotrix1 / Pack-Maker</span><ArrowUpRight size={18} className="text-slate-500" /></div><div className="space-y-3 py-5 text-sm text-slate-300"><p className="flex gap-3"><Check size={16} className="shrink-0 text-cyan-300" />Free to inspect, improve and build yourself</p><p className="flex gap-3"><Check size={16} className="shrink-0 text-cyan-300" />Community-driven practical mapping workflows</p><p className="flex gap-3"><Check size={16} className="shrink-0 text-cyan-300" />No cloud account required for the desktop app</p></div><div className="rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-xs text-slate-500">github.com/Rotrix1/Pack-Maker</div></div></Reveal></section>

        <section id="credits" className="mx-auto max-w-[84rem] px-5 py-16 lg:px-8 lg:py-20"><Reveal><div className="flex flex-col justify-between gap-10 rounded-[1.5rem] border border-white/[0.09] bg-white/[0.025] p-7 sm:p-10 lg:flex-row lg:items-end"><div><p className="eyebrow">CREDITS</p><h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white">Made for practical pack-building.</h2><p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">Created by Rotrix. Developed with contribution from Pofanek and shaped through practical osu!mania pack-building workflows.</p></div><div className="flex flex-wrap gap-3">{credits.map((credit) => <a key={credit.name} href={credit.href} target="_blank" rel="noreferrer" className="group min-w-40 rounded-xl border border-white/10 bg-[#0b0c15] p-4 transition hover:-translate-y-0.5 hover:border-pink-300/40"><p className="text-xs font-bold uppercase tracking-wider text-pink-200">{credit.role}</p><p className="mt-1 flex items-center gap-1.5 text-base font-extrabold text-white">{credit.name}<ArrowUpRight size={15} className="text-slate-500 transition group-hover:text-cyan-200" /></p></a>)}</div></div></Reveal></section>

        <section className="relative isolate overflow-hidden border-t border-white/[0.08] bg-[#0d0e19] py-16 lg:py-24"><div className="absolute left-1/2 top-1/2 -z-10 h-80 w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/15 blur-3xl" /><Reveal className="mx-auto max-w-3xl px-5 text-center"><Music4 size={30} className="mx-auto text-pink-300" /><h2 className="mt-5 text-4xl font-black tracking-[-0.05em] text-white sm:text-5xl">Ready to build your next pack?</h2><p className="mx-auto mt-5 max-w-xl text-base leading-7 text-slate-300">Keep your workflow local, simple and non-destructive—from your Songs folder to a fresh .osz.</p><div className="mt-8 flex flex-wrap justify-center gap-3"><ButtonLink href={releaseUrl} primary><Download size={18} />Download for Windows</ButtonLink><ButtonLink href={githubUrl}><Code2 size={18} />View source on GitHub</ButtonLink></div><p className="mt-5 text-xs text-slate-500">Your original beatmaps stay untouched. Every export is generated as a new .osz.</p></Reveal></section>
      </main>
      <footer className="border-t border-white/[0.07] bg-[#07080f]"><div className="mx-auto flex max-w-[84rem] flex-col gap-6 px-5 py-8 text-sm sm:flex-row sm:items-center sm:justify-between lg:px-8"><Brand /><div className="flex flex-wrap gap-x-5 gap-y-2 text-slate-400"><a href={githubUrl} target="_blank" rel="noreferrer" className="hover:text-cyan-200">GitHub</a><a href={`${githubUrl}/issues`} target="_blank" rel="noreferrer" className="hover:text-cyan-200">Issues</a><a href="#credits" className="hover:text-cyan-200">Credits</a><a href="#open-source" className="hover:text-cyan-200">Open Source</a></div><p className="max-w-sm text-xs leading-5 text-slate-500 sm:text-right">Community tool. Not officially affiliated with osu! or ppy.</p></div></footer>
    </div>
  )
}

export default App
