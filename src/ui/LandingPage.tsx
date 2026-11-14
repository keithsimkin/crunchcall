import { useEffect, useId, useState, type ReactNode } from 'react'
import { LogoMark } from './icons'
import { BUY_URL } from './useLicense'
import { legalCopy, SUPPORT_EMAIL, type LegalKind } from './legalCopy'
import './LandingPage.css'

type Surface = 'list' | 'live' | 'settings'

type LandingPageProps = {
  onOpenApp: (next?: Surface) => void
}

type InfoSheet =
  | { kind: 'legal'; doc: LegalKind }
  | { kind: 'note'; id: 'data' | 'nobot' | 'support' | 'help' | 'bug' | 'feature' }

const noteCopy: Record<
  Extract<InfoSheet, { kind: 'note' }>['id'],
  { title: string; body: string[]; email?: boolean }
> = {
  data: {
    title: 'Data stays on this PC',
    body: [
      'Capture, transcription, and the first draft of your notes live on this Windows PC.',
      'Nothing leaves the machine unless you choose a cloud speech engine or bring your own key for text.',
    ],
  },
  nobot: {
    title: 'No meeting bot',
    body: [
      'annotated never joins Zoom, Meet, Teams, or any other call as a guest.',
      'It listens on this PC, so the people on the call do not see another participant from us.',
    ],
  },
  support: {
    title: 'Get support',
    body: ['Email us and we will help.'],
    email: true,
  },
  help: {
    title: 'Help center',
    body: ['We do not have a separate help site yet. Email us with what you need.'],
    email: true,
  },
  bug: {
    title: 'Report a bug',
    body: ['Tell us what happened, what you expected, and your Windows version if you can.'],
    email: true,
  },
  feature: {
    title: 'Request a feature',
    body: ['Tell us what would make annotated more useful for your calls.'],
    email: true,
  },
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

function CompareMark({ yes, us }: { yes: boolean; us?: boolean }) {
  return (
    <td className={us ? 'is-us' : undefined}>
      <span className={yes ? 'lp-mark is-yes' : 'lp-mark is-no'} aria-label={yes ? 'Yes' : 'No'}>
        {yes ? (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              d="M4.2 9.2 7.3 12.2 13.8 5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              d="M5.2 5.2 12.8 12.8M12.8 5.2 5.2 12.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
    </td>
  )
}

const plans: {
  id: string
  name: string
  price: string
  cadence: string
  blurb: string
  cta: string
  featured: boolean
  recommend?: string
  comingSoon?: boolean
  buy?: boolean
  items: string[]
}[] = [
  {
    id: 'unlock',
    name: 'Unlock',
    price: '$35',
    cadence: 'one time',
    blurb: 'The full notepad for one Windows PC. Try it free for seven days.',
    cta: 'Start 7-day trial',
    featured: true,
    recommend: 'Recommended if the calls are the job',
    buy: true,
    items: [
      '7-day free trial',
      'Run everything locally',
      'Or bring your own Claude or OpenAI key',
      'Live coaching overlay',
      'Markdown export of the notes',
      'One PC · pay once',
    ],
  },
  {
    id: 'twopack',
    name: 'Two keys',
    price: '$45',
    cadence: 'for 2 PCs',
    blurb: 'Two unlock licenses. The second key is about 70% off.',
    cta: 'Buy two keys',
    featured: false,
    buy: true,
    items: [
      'Two Unlock licenses',
      'Second key ~70% off ($35 + $10)',
      'Run locally or bring your own key',
      'Live coaching on both PCs',
      'One-time payment',
    ],
  },
  {
    id: 'sub',
    name: 'Subscribe',
    price: '$10',
    cadence: 'per month',
    blurb: 'Same unlock features on a monthly plan, when you prefer a subscription.',
    cta: 'Coming soon',
    featured: false,
    comingSoon: true,
    items: [
      'Everything in Unlock',
      'Live coaching overlay',
      'Markdown export of the notes',
      '$10 per month',
      'Cancel anytime',
    ],
  },
]

function InfoDialog({
  sheet,
  onClose,
}: {
  sheet: InfoSheet
  onClose: () => void
}) {
  const titleId = useId()
  const legal = sheet.kind === 'legal' ? legalCopy[sheet.doc] : null
  const note = sheet.kind === 'note' ? noteCopy[sheet.id] : null
  const title = legal?.title ?? note?.title ?? ''

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="lp-info">
      <button type="button" className="lp-info-scrim" aria-label="Close" onClick={onClose} />
      <div className="lp-info-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="lp-info-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {legal ? <p className="lp-info-meta">Last updated {legal.updated}.</p> : null}
          </div>
          <button type="button" className="lp-info-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="lp-info-body">
          {legal
            ? legal.sections.map((section) => (
                <section key={section.heading}>
                  <h3>{section.heading}</h3>
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </section>
              ))
            : null}
          {note
            ? note.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))
            : null}
          {note?.email ? (
            <p className="lp-info-email">
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function LandingPage({ onOpenApp }: LandingPageProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [arrived, setArrived] = useState<string | null>(null)
  const [info, setInfo] = useState<InfoSheet | null>(null)

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

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.lp-reveal'))
    if (reduce) {
      nodes.forEach((node) => node.classList.add('is-visible'))
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1, rootMargin: '0px 0px -30px 0px' },
    )
    nodes.forEach((node) => observer.observe(node))
    const fallback = window.setTimeout(() => {
      nodes.forEach((node) => node.classList.add('is-visible'))
    }, 2500)
    return () => {
      window.clearTimeout(fallback)
      observer.disconnect()
    }
  }, [])

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
    if (id === 'coaching' || id === 'notes' || id === 'ask' || id === 'product') {
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
              Features
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
            Open the app
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
              while it still matters, leaves owners and next steps when you hang up, and lets Ask answer from
              those notes anytime.
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

        <section className="lp-platforms lp-reveal" aria-label="Call platforms">
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

        <section className="lp-about lp-reveal" aria-labelledby="about-title">
          <Kicker>About</Kicker>
          <h2 id="about-title" className="lp-sr">
            About annotated
          </h2>
          <p>
            annotated helps you leave a meeting with the notes, the owners, and the next step. No bot joins Zoom,
            Meet, or Teams. Transcription and the first summary run on this PC. Ask answers from that same local
            history. A bigger model is optional, and it only ever sees text.
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

        <section id="product" className="lp-reveal" aria-labelledby="product-title">
          <div className="lp-block">
            <Kicker>Capabilities</Kicker>
            <h2 id="product-title">The tools a meeting needs, without another guest.</h2>
            <p className="lp-sub">
              Coaching while the call is still open. Notes when it is over. Ask whenever you need an answer from
              what you already captured.
            </p>
          </div>
          <div className="lp-feature-scene">
            <div className="lp-feature-grid lp-reveal lp-reveal-stagger">
              <article
                className={arrived === 'coaching' || arrived === 'product' ? 'lp-feature-card is-arrived' : 'lp-feature-card'}
                id="coaching"
              >
                <h3>Live coaching</h3>
                <p>
                  Quiet mid-call cues for a missing date, stacked questions, and talk ratio — while you can still do
                  something about it. Hidden from screen share.
                </p>
                <div className="lp-shot lp-shot-zoom">
                  <img
                    src="/landing/shot-coaching-focus.png?v=desk"
                    alt="Live call cues panel beside the transcript: mid-call coaching that stays off screen share."
                  />
                </div>
              </article>

              <article className={arrived === 'notes' || arrived === 'product' ? 'lp-feature-card is-arrived' : 'lp-feature-card'} id="notes">
                <h3>Notes that land</h3>
                <p>
                  Summary, owners, and due dates, searchable on this PC. Export Markdown when you want to share the
                  notes, not the whole transcript.
                </p>
                <div className="lp-shot lp-shot-zoom">
                  <img
                    src="/landing/shot-notes-focus.png?v=desk"
                    alt="Notes for Pricing review with Northwind: summary, takeaways, and next steps with owners and due dates."
                  />
                </div>
              </article>
            </div>

            <article
              className={
                arrived === 'ask' || arrived === 'product'
                  ? 'lp-feature-card lp-feature-ask is-arrived lp-reveal'
                  : 'lp-feature-card lp-feature-ask lp-reveal'
              }
              id="ask"
            >
              <div className="lp-ask-copy">
                <h3>Ask your notes</h3>
                <p>
                  The small chat bar at the bottom of the app answers from meetings, notes, actions, and calendar
                  already on this PC. Tag a person, meeting, or project when you want a tighter answer — without
                  shipping audio off the machine.
                </p>
                <ul className="lp-ask-points">
                  <li>Who owns the open next steps?</li>
                  <li>What did we decide on pricing?</li>
                  <li>What is coming up this week?</li>
                </ul>
              </div>
              <div className="lp-shot lp-shot-ask">
                <img
                  src="/landing/shot-ask.png?v=desk"
                  alt="Ask open in annotated: tag people, projects, skills, or meetings, then ask from notes on this PC."
                />
              </div>
            </article>
          </div>
        </section>

        <section className="lp-block lp-reveal" id="connect" aria-labelledby="connect-title">
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

        <section className="lp-block lp-reveal" id="compare" aria-labelledby="compare-title">
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
                  <CompareMark us yes={false} />
                  <CompareMark yes={false} />
                  <td>Often</td>
                  <td>Often</td>
                  <td>Often</td>
                </tr>
                <tr>
                  <th scope="row">Audio stays on this PC</th>
                  <CompareMark us yes />
                  <CompareMark yes={false} />
                  <CompareMark yes={false} />
                  <CompareMark yes={false} />
                  <CompareMark yes={false} />
                </tr>
                <tr>
                  <th scope="row">Coaching while the call is open</th>
                  <CompareMark us yes />
                  <CompareMark yes={false} />
                  <CompareMark yes={false} />
                  <CompareMark yes={false} />
                  <CompareMark yes={false} />
                </tr>
                <tr>
                  <th scope="row">Ask across notes on this PC</th>
                  <CompareMark us yes />
                  <td>Cloud chat</td>
                  <td>Cloud chat</td>
                  <td>Cloud chat</td>
                  <td>Cloud chat</td>
                </tr>
                <tr>
                  <th scope="row">Account required</th>
                  <CompareMark us yes={false} />
                  <CompareMark yes />
                  <CompareMark yes />
                  <CompareMark yes />
                  <CompareMark yes />
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

        <section className="lp-block lp-pricing lp-reveal" id="pricing" aria-labelledby="pricing-title">
          <Kicker>Pricing</Kicker>
          <h2 id="pricing-title">A notepad you buy once.</h2>
          <p className="lp-sub">
            Seven-day free trial, then $35 once for one PC — run everything locally, or bring your own Claude or
            OpenAI key. Two keys are $45. A $10/month plan is coming soon.
          </p>
          <div className="lp-plans">
            {plans.map((plan) => (
              <article
                key={plan.id}
                className={[
                  'lp-plan',
                  plan.featured ? 'featured' : '',
                  plan.comingSoon ? 'coming-soon' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="lp-plan-head">
                  <div className="lp-recommend-slot">
                    {plan.recommend ? <p className="lp-recommend">{plan.recommend}</p> : null}
                  </div>
                  <h3>{plan.name}</h3>
                  <p className="lp-price">
                    {plan.price}
                    <small>{plan.cadence}</small>
                  </p>
                  <p className="lp-plan-blurb">{plan.blurb}</p>
                </div>
                <p className="lp-youget">You get</p>
                <ul>
                  {plan.items.map((item) => (
                    <li key={item}>
                      <Check />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="lp-btn lp-plan-cta"
                  disabled={plan.comingSoon}
                  aria-disabled={plan.comingSoon || undefined}
                  onClick={() => {
                    if (plan.comingSoon) return
                    if (plan.buy) {
                      window.open(BUY_URL, '_blank', 'noopener,noreferrer')
                    }
                  }}
                >
                  {plan.cta}
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="lp-footer lp-reveal">
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
                href="#ask"
                onClick={(event) => {
                  event.preventDefault()
                  go('ask')
                }}
              >
                Ask
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
              <a
                href="#connect"
                onClick={(event) => {
                  event.preventDefault()
                  go('connect')
                }}
              >
                Integrations
              </a>
              <button type="button" onClick={() => onOpenApp('list')}>
                Open the app
              </button>
            </div>
            <div className="lp-footcol">
              <h3>Privacy</h3>
              <button type="button" onClick={() => setInfo({ kind: 'legal', doc: 'privacy' })}>
                Privacy policy
              </button>
              <button type="button" onClick={() => setInfo({ kind: 'legal', doc: 'terms' })}>
                Terms of service
              </button>
              <button type="button" onClick={() => setInfo({ kind: 'note', id: 'data' })}>
                Data stays on this PC
              </button>
              <button type="button" onClick={() => setInfo({ kind: 'note', id: 'nobot' })}>
                No meeting bot
              </button>
            </div>
            <div className="lp-footcol">
              <h3>Support</h3>
              <a href="/account">Your licenses</a>
              <button type="button" onClick={() => setInfo({ kind: 'note', id: 'support' })}>
                Get support
              </button>
              <button type="button" onClick={() => setInfo({ kind: 'note', id: 'help' })}>
                Help center
              </button>
              <button type="button" onClick={() => setInfo({ kind: 'note', id: 'bug' })}>
                Report a bug
              </button>
              <button type="button" onClick={() => setInfo({ kind: 'note', id: 'feature' })}>
                Request a feature
              </button>
            </div>
          </div>
          <div className="lp-footer-base">
            <p>© 2026 annotated · annotated.click</p>
            <p>Windows-first · Local by default</p>
          </div>
        </div>
      </footer>

      <section className="lp-wordmark" aria-label="annotated">
        <img src="/landing/moss-wordmark.jpg" alt="" />
        <strong>annotated</strong>
      </section>

      {info ? <InfoDialog sheet={info} onClose={() => setInfo(null)} /> : null}
    </div>
  )
}
