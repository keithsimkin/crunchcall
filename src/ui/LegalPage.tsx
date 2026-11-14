import './account.css'
import { legalCopy, type LegalKind } from './legalCopy'

export function LegalPage({ kind }: { kind: LegalKind }) {
  const page = legalCopy[kind]
  const other = kind === 'privacy' ? { href: '/terms', label: 'Terms of service' } : { href: '/privacy', label: 'Privacy policy' }

  return (
    <div className="account-page legal-page">
      <main>
        <p className="fine">
          <a href="/">annotated</a>
          {' · '}
          <a href={other.href}>{other.label}</a>
        </p>
        <h1>{page.title}</h1>
        <p className="lede">Last updated {page.updated}.</p>
        {page.sections.map((section) => (
          <article key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
        ))}
      </main>
    </div>
  )
}
