import { useEffect, useState, type ReactNode } from 'react'
import { LogoMark } from './icons'
import { BUY_URL } from './useLicense'
import './LandingPage.css'

type Surface = 'list' | 'live' | 'settings'

type LandingPageProps = {
  onOpenApp: (next?: Surface) => void
}

type Brand = {
  id: string
  name: string
  src: string
  wide?: boolean
}

const callPlatforms: Brand[] = [
  { id: 'zoom', name: 'Zoom', src: '/logos/zoom.svg', wide: true },
  { id: 'meet', name: 'Google Meet', src: '/logos/meet.svg' },
  { id: 'teams', name: 'Microsoft Teams', src: '/logos/teams.svg' },
  { id: 'slack', name: 'Slack', src: '/logos/slack.svg' },
  { id: 'webex', name: 'Webex', src: '/logos/webex.svg' },
]

const ecosystem: Brand[] = [
  ...callPlatforms,
  { id: 'claude', name: 'Claude', src: '/logos/claude.svg' },
  { id: 'openai', name: 'OpenAI', src: '/logos/openai.svg' },
]

function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="lp-kicker">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          d="M7 1.1c.35 1.9 1 3 2.6 3.6C8 5.3 7.35 6.4 7 8.3 6.65 6.4 6 5.3 4.4 4.7 6 4.1 6.65 3 7 1.1Z"
          fill="currentColor"
        />
        <path
          d="M11.1 7.2c.2 1.05.55 1.6 1.4 1.9-.85.3-1.2.85-1.4 1.9-.2-1.05-.55-1.6-1.4-1.9.85-.3 1.2-.85 1.4-1.9Z"
          fill="currentColor"
        />
      </svg>
      {children}
    </p>
  )
}

function BrandHead({ name, src, us }: { name: string; src?: string; us?: boolean }) {
  return (
    <th scope="col" className={us ? 'is-us' : undefined}>
      <span className="lp-compare-name">
        <span className={src ? 'lp-compare-logo' : 'lp-compare-logo is-mark'}>
          {src ? <img src={src} alt="" className={src.endsWith('.png') ? 'is-fill' : undefined} /> : <LogoMark size={40} />}
        </span>
        {name}
      </span>
    </th>
  )
}

function Check() {
  return (
    <svg className="lp-check" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.8 8.2 7 10.3l4.2-4.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const plans: {
  id: string
  name: string
  price: string
  cadence: string
  blurb: string
  cta: string
  surface: Surface
  featured: boolean
  recommend?: string
  items: string[]
}[] = [
  {
    id: 'local',
    name: 'Local',
    price: 'Free',
    cadence: 'on this PC',
    blurb: 'Notes for the calls you take, with no account and no bot.',
    cta: 'Open the app',
    surface: 'list',
    featured: false,
    items: [
      'Capture on this PC, with no guest in the meeting',
      'On-device transcription',
      'Local summaries and action items',
      'Searchable history',
      'No account required',
    ],
  },
  {
    id: 'unlock',
    name: 'Unlock',
    price: '$35',
    cadence: 'one time',
    blurb: 'The full notepad, including coaching while the call is still open.',
    cta: 'Buy the unlock',
    surface: 'list',
    featured: true,
    recommend: 'Recommended if the calls are the job',
    items: [
      'Everything in Local',
      'Live coaching overlay',
      'Screen-share-safe cues',
      'Markdown export of the notes',
      '$35 one-time payment, no subscription',
    ],
  },
  {
    id: 'byok',
    name: 'Your key',
    price: 'Optional',
    cadence: 'text only',
    blurb: 'Bring Claude or OpenAI when you want a bigger model for the notes.',
    cta: 'Set up a key',
    surface: 'settings',
    featured: false,
    items: [
      'Your Claude or OpenAI key',
      'Used for text, never for audio',
      'Audio still stays on the device',
      'Keys stay in Windows Credential Manager',
      'Off unless you turn it on',
    ],
  },
]

export function LandingPage({ onOpenApp }: LandingPageProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [arrived, setArrived] = useState<string | null>(null)

  useEffect(() => {
    const body = document.body
    const prevBg = body.style.backgroundColor
    body.style.backgroundColor = '#f5f5f3'
    return () => {
      body.style.backgroundColor = prevBg
    }
  }, [])

  useEffect(() => {
    const id = window.location.hash.replace('#', '')
    if (!id || id === 'top') return
    const target = document.getElementById(id)
    if (!target) return
    const nav = document.querySelector<HTMLElement>('.lp-navwrap')
    const clearance = (nav?.getBoundingClientRect().height ?? 80) + 20
    const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - clearance)
    window.scrollTo({ top, behavior: 'auto' })
  }, [])

  useEffect(() => {
    if (!arrived) return
    const timer = window.setTimeout(() => setArrived(null), 1800)
    return () => window.clearTimeout(timer)
  }, [arrived])

  function go(id: string) {
    setMenuOpen(false)
    const target = document.getElementById(id)
    if (!target) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
    const nav = document.querySelector<HTMLElement>('.lp-navwrap')
    const clearance = (nav?.getBoundingClientRect().height ?? 80) + 20
    const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - clearance)
    const pageScrolls = document.documentElement.scrollHeight > window.innerHeight + 2
    if (pageScrolls) window.scrollTo({ top, behavior })
    else target.scrollIntoView({ behavior, block: 'start' })
    if (id === 'coaching' || id === 'notes' || id === 'product') {
      setArrived(null)
      window.requestAnimationFrame(() => setArrived(id))
    }
  }

  return (
    <div className="landing">
      <div className="lp-drag" aria-hidden="true" />
      <div className="lp-navwrap">
        <header className={menuOpen ? 'lp-nav open' : 'lp-nav'}>
          <a
            className="lp-brand"
            href="#top"
            onClick={(event) => {
              event.preventDefault()
              go('top')
            }}
          >
            <LogoMark />
            annotated
          </a>
          <button
            type="button"
            className="lp-menu"
            aria-expanded={menuOpen}
            aria-controls="lp-sections"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </button>
          <nav id="lp-sections" aria-label="Page">
            <a
              href="#product"
              onClick={(event) => {
                event.preventDefault()
                go('product')
              }}
            >
              Coaching & notes
            </a>
            <a
              href="#pricing"
              onClick={(event) => {
                event.preventDefault()
                go('pricing')
              }}
            >
              Pricing
            </a>
          </nav>
          <button type="button" className="lp-nav-cta" onClick={() => onOpenApp('list')}>
            Download app
          </button>
        </header>
      </div>

      <main>
        <section className="lp-hero" id="top">
          <div className="lp-narrow">
            <h1>
              Annotate every call.
              <br />
              Keep the notes.
              <br />
              Leave the bot out.
            </h1>
            <p>
              A local-first notepad for the meetings you are already in. It transcribes on this PC, nudges you
              while it still matters, and leaves owners and next steps when you hang up.
            </p>
            <div className="lp-hero-actions">
              <button type="button" className="lp-btn lp-btn-dark" onClick={() => onOpenApp('list')}>
                Open the app
              </button>
              <a
                className="lp-btn lp-btn-ghost"
                href="#product"
                onClick={(event) => {
                  event.preventDefault()
                  go('product')
                }}
              >
                See the product
              </a>
            </div>
          </div>

          <div className="lp-scene">
            <img src="/landing/moss-hero.jpg" alt="" />
            <div className="lp-device-wrap">
              <figure className="lp-viewport">
                <img
                  src="/landing/shot-hero.png?v=home"
                  alt="annotated on Home, the meeting history on this PC, in a Windows window."
                />
                <figcaption className="lp-sr">
                  annotated on Home. Meeting history stays on this PC. The window has the Windows minimize, maximize,
                  and close buttons.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="lp-platforms" aria-label="Call platforms">
          <p>Beside the calls you already take. Never in the participant list.</p>
          <ul className="lp-logo-row">
            {callPlatforms.map((brand) => (
              <li key={brand.id}>
                <img
                  src={brand.src}
                  alt=""
                  className={brand.wide ? 'is-wide' : undefined}
                  width={brand.wide ? 84 : 28}
                  height={28}
                />
                <span>{brand.name}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-about" aria-labelledby="about-title">
          <Kicker>About</Kicker>
          <h2 id="about-title" className="lp-sr">
            About annotated
          </h2>
          <p>
            annotated helps you leave a meeting with the notes, the owners, and the next step. No bot joins Zoom,
            Meet, or Teams. Transcription and the first summary run on this PC. A bigger model is optional, and it
            only ever sees text.
          </p>
          <div className="lp-stats">
            <article>
              <strong>0</strong>
              <span>Bots on the call</span>
            </article>
            <article>
              <strong>100%</strong>
              <span>On-device by default</span>
            </article>
            <article>
              <strong>$35</strong>
              <span>One-time payment, not monthly</span>
            </article>
          </div>
        </section>

        <section id="product" aria-labelledby="product-title">
          <div className="lp-block">
            <Kicker>Capabilities</Kicker>
            <h2 id="product-title">The tools a meeting needs, without another guest.</h2>
            <p className="lp-sub">Coaching while the call is still open. Notes, owners, and next steps when it is over.</p>
          </div>
          <div className="lp-feature-scene">
            <div className="lp-feature-grid">
              <article
                className={arrived === 'coaching' || arrived === 'product' ? 'lp-feature-card is-arrived' : 'lp-feature-card'}
                id="coaching"
              >
                <h3>Live coaching</h3>
                <p>
                  Quiet mid-call cues for a missing date, stacked questions, and talk ratio — while you can still do
                  something about it. Hidden from screen share.
                </p>
                <div className="lp-shot">
                  <img
                    src="/landing/shot-live-call.png?v=light"
                    alt="Live Product sync in annotated: the transcript, a paused timer, and the cues panel."
                  />
                </div>
              </article>

              <article className={arrived === 'notes' || arrived === 'product' ? 'lp-feature-card is-arrived' : 'lp-feature-card'} id="notes">
                <h3>Notes that land</h3>
                <p>
                  Summary, owners, and due dates, searchable on this PC. Export Markdown when you want to share the
                  notes, not the whole transcript.
                </p>
                <div className="lp-shot">
                  <img
                    src="/landing/shot-notes.png?v=light"
                    alt="Notes for Pricing review with Northwind: summary, takeaways, and next steps with owners and due dates."
                  />
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="lp-block" id="connect" aria-labelledby="connect-title">
          <Kicker>Integrations</Kicker>
          <h2 id="connect-title">Private by default. A bigger model only if you bring one.</h2>
          <p className="lp-sub">
            Audio stays on this machine. Claude and OpenAI see text only, and only when you turn that on.
          </p>
          <ul className="lp-icon-grid">
            {ecosystem.map((brand) => (
              <li key={brand.id}>
                <span className="lp-tile">
                  <img src={brand.src} alt="" className={brand.wide ? 'is-wide' : undefined} />
                </span>
                <span>{brand.name}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-block" id="compare" aria-labelledby="compare-title">
          <Kicker>Compare</Kicker>
          <h2 id="compare-title">Next to the notepads people already use.</h2>
          <p className="lp-sub">
            Granola also stays out of the participant list. Otter, Fireflies, and Fathom usually join the call. None
            of them keep the audio on this PC.
          </p>
          <div className="lp-compare-scroll">
            <table className="lp-compare">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="lp-sr">Point of comparison</span>
                  </th>
                  <BrandHead name="annotated" us />
                  <BrandHead name="Granola" src="/logos/granola.png" />
                  <BrandHead name="Otter" src="/logos/otter.svg" />
                  <BrandHead name="Fireflies" src="/logos/fireflies.svg" />
                  <BrandHead name="Fathom" src="/logos/fathom.svg" />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Bot in the meeting</th>
                  <td className="is-us">No</td>
                  <td>No</td>
                  <td>Often</td>
                  <td>Often</td>
                  <td>Often</td>
                </tr>
                <tr>
                  <th scope="row">Audio stays on this PC</th>
                  <td className="is-us">Yes</td>
                  <td>No</td>
                  <td>No</td>
                  <td>No</td>
                  <td>No</td>
                </tr>
                <tr>
                  <th scope="row">Coaching while the call is open</th>
                  <td className="is-us">Yes</td>
                  <td>No</td>
                  <td>No</td>
                  <td>No</td>
                  <td>No</td>
                </tr>
                <tr>
                  <th scope="row">Account required</th>
                  <td className="is-us">No</td>
                  <td>Yes</td>
                  <td>Yes</td>
                  <td>Yes</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <th scope="row">How you pay</th>
                  <td className="is-us">$35 once</td>
                  <td>Subscription</td>
                  <td>Subscription</td>
                  <td>Subscription</td>
                  <td>Subscription</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="lp-compare-note">
            Otter, Fireflies, and Fathom can also record without a bot in some apps. A bot is still how they usually
            join. Their plans and prices change.
          </p>
        </section>

        <section className="lp-block lp-pricing" id="pricing" aria-labelledby="pricing-title">
          <Kicker>Pricing</Kicker>
          <h2 id="pricing-title">A notepad you buy once.</h2>
          <p className="lp-sub">
            Local notes need no account. Coaching and Markdown export are a $35 one-time payment. The installer is signed, and the app checks the license on this PC.
          </p>
          <div className="lp-plans">
            {plans.map((plan) => (
              <article key={plan.id} className={plan.featured ? 'lp-plan featured' : 'lp-plan'}>
                {plan.recommend ? <p className="lp-recommend">{plan.recommend}</p> : null}
                <h3>{plan.name}</h3>
                <p className="lp-price">
                  {plan.price}
                  <small>{plan.cadence}</small>
                </p>
                <p className="lp-plan-blurb">{plan.blurb}</p>
                <button
                  type="button"
                  className="lp-btn lp-plan-cta"
                  onClick={() => {
                    if (plan.id === 'unlock') {
                      window.open(BUY_URL, '_blank', 'noopener,noreferrer')
                      return
                    }
                    onOpenApp(plan.surface)
                  }}
                >
                  {plan.cta}
                </button>
                <p className="lp-youget">You get</p>
                <ul>
                  {plan.items.map((item) => (
                    <li key={item}>
                      <Check />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-top">
            <div>
              <p className="lp-footer-brand">
                <LogoMark />
                annotated
              </p>
              <p>
                A local-first meeting notepad for Windows. No bot joins the call. Notes stay on this PC unless you
                choose a key for the text.
              </p>
            </div>
            <div className="lp-footer-aside">
              <p className="lp-footer-kicker">On this machine</p>
              <p>Windows-first. Capture, transcription, and the first draft of the notes do not need an account.</p>
            </div>
          </div>
          <div className="lp-footer-links">
            <div className="lp-footcol">
              <h3>Product</h3>
              <a
                href="#product"
                onClick={(event) => {
                  event.preventDefault()
                  go('product')
                }}
              >
                Coaching & notes
              </a>
              <a
                href="#pricing"
                onClick={(event) => {
                  event.preventDefault()
                  go('pricing')
                }}
              >
                Pricing
              </a>
            </div>
            <div className="lp-footcol">
              <h3>Privacy</h3>
              <a
                href="#product"
                onClick={(event) => {
                  event.preventDefault()
                  go('product')
                }}
              >
                No meeting bot
              </a>
              <a
                href="#connect"
                onClick={(event) => {
                  event.preventDefault()
                  go('connect')
                }}
              >
                Audio stays on this PC
              </a>
              <a
                href="#connect"
                onClick={(event) => {
                  event.preventDefault()
                  go('connect')
                }}
              >
                A key sees text only
              </a>
              <a
                href="#pricing"
                onClick={(event) => {
                  event.preventDefault()
                  go('pricing')
                }}
              >
                No account for local mode
              </a>
            </div>
            <div className="lp-footcol">
              <h3>App</h3>
              <button type="button" onClick={() => onOpenApp('list')}>
                Open the app
              </button>
              <button type="button" onClick={() => onOpenApp('live')}>
                Start a meeting
              </button>
              <button type="button" onClick={() => onOpenApp('settings')}>
                Settings
              </button>
            </div>
          </div>
          <div className="lp-footer-base">
            <p>
              © 2026 annotated · <a href="https://annotated.click">annotated.click</a>
            </p>
            <p>Windows-first · Local by default</p>
          </div>
        </div>
      </footer>

      <section className="lp-wordmark" aria-label="annotated">
        <img src="/landing/moss-wordmark.jpg" alt="" />
        <strong>annotated</strong>
      </section>
    </div>
  )
}
