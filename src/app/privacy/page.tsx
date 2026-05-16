import Link from 'next/link'
import { LegalShell } from '@/components/marketing/MarketingFrame'
import { LEGAL } from '@/lib/legal-config'

export const metadata = {
  title: 'Privacy Policy — Quilpen',
  description:
    'How Quilpen collects, uses, and protects your personal data. GDPR-compliant.',
}

const SUBPROCESSORS = [
  {
    name: 'Anthropic, PBC',
    purpose: 'Large language model inference (Claude) for AI writing assistance',
    region: 'United States',
    url: 'https://www.anthropic.com/legal/privacy',
  },
  {
    name: 'Paddle.com Market Limited',
    purpose: 'Payment processing as Merchant of Record (subscriptions, taxes, invoicing)',
    region: 'United Kingdom',
    url: 'https://www.paddle.com/legal/privacy',
  },
  {
    name: 'Railway Corp.',
    purpose: 'Application and database hosting',
    region: 'United States',
    url: 'https://railway.com/legal/privacy',
  },
  {
    name: 'Resend, Inc.',
    purpose: 'Transactional email delivery (sign-in, billing, account)',
    region: 'United States',
    url: 'https://resend.com/legal/privacy-policy',
  },
  {
    name: 'Google LLC',
    purpose: 'Optional Google sign-in (OAuth) and image generation for non-academic projects',
    region: 'United States',
    url: 'https://policies.google.com/privacy',
  },
  {
    name: 'Kroki',
    purpose: 'Server-side rendering of charts, diagrams, and equations (no PII sent)',
    region: 'European Union',
    url: 'https://kroki.io/',
  },
] as const

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This Privacy Policy explains how {LEGAL.legalEntity} (&quot;we&quot;, &quot;us&quot;)
        collects, uses, shares, and protects personal data when you use{' '}
        <Link href="/">{LEGAL.brand}</Link> (the &quot;Service&quot;). We are the{' '}
        <strong>data controller</strong> for personal data processed through the Service.
      </p>

      <h2>1. What we collect</h2>
      <h3>You give us</h3>
      <ul>
        <li>
          <strong>Account data:</strong> name, email, hashed password, and (if you sign in
          with Google) Google account ID + profile photo URL.
        </li>
        <li>
          <strong>Project content:</strong> manuscripts, chapter outlines, sources you
          upload, citations, and any text you generate or edit through the Service.
        </li>
        <li>
          <strong>Billing data:</strong> handled by our payment processor (Paddle); we
          receive only a customer ID, subscription status, the last four digits of the
          card, country, and invoice metadata. We never see your full card number.
        </li>
      </ul>
      <h3>Collected automatically</h3>
      <ul>
        <li>
          <strong>Usage data:</strong> AI-operation logs (which feature, how many credits,
          model used, token counts), error logs, request paths, timestamps.
        </li>
        <li>
          <strong>Device data:</strong> IP address (truncated for analytics), browser type,
          OS, screen size, and a session cookie used to keep you signed in.
        </li>
      </ul>

      <h2>2. Why we use it (legal bases under GDPR)</h2>
      <ul>
        <li>
          <strong>To provide the Service</strong> — performance of the contract you have
          with us (Art. 6(1)(b) GDPR).
        </li>
        <li>
          <strong>To process payments and send transactional email</strong> — performance
          of contract.
        </li>
        <li>
          <strong>To secure the Service, prevent abuse, and debug issues</strong> —
          legitimate interest (Art. 6(1)(f)).
        </li>
        <li>
          <strong>To improve the Service in aggregate (anonymised metrics)</strong> —
          legitimate interest.
        </li>
        <li>
          <strong>To comply with legal obligations (tax, accounting, lawful requests)</strong>{' '}
          — legal obligation (Art. 6(1)(c)).
        </li>
      </ul>
      <p>
        We do <strong>not</strong> use your project content to train AI models, and we do
        not sell personal data to third parties.
      </p>

      <h2>3. How AI processing works</h2>
      <p>
        When you trigger an AI operation (e.g. drafting a section, generating an abstract),
        the relevant excerpt of your project — and only that excerpt — is sent over TLS to
        Anthropic&apos;s API. Anthropic processes the request to return a completion and
        does not retain the data for model training under the API terms applicable to us.
        See <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer">Anthropic&apos;s privacy policy</a>.
      </p>

      <h2>4. Subprocessors</h2>
      <p>
        We share personal data only with the following subprocessors, each bound by a data
        processing agreement and appropriate transfer safeguards (Standard Contractual
        Clauses where applicable):
      </p>
      <div className="overflow-x-auto -mx-2 my-3">
        <table className="w-full text-left border border-sandy/60 rounded-sm">
          <thead>
            <tr className="bg-page/60 border-b border-sandy/60">
              <th className="px-3 py-2 font-ui text-xs uppercase tracking-wider text-ink-light">
                Subprocessor
              </th>
              <th className="px-3 py-2 font-ui text-xs uppercase tracking-wider text-ink-light">
                Purpose
              </th>
              <th className="px-3 py-2 font-ui text-xs uppercase tracking-wider text-ink-light">
                Region
              </th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((sp) => (
              <tr key={sp.name} className="border-b border-sandy/30 last:border-0">
                <td className="px-3 py-2 align-top font-ui text-sm text-ink">
                  <a href={sp.url} target="_blank" rel="noopener noreferrer">
                    {sp.name}
                  </a>
                </td>
                <td className="px-3 py-2 align-top font-ui text-sm text-ink-light">
                  {sp.purpose}
                </td>
                <td className="px-3 py-2 align-top font-ui text-sm text-ink-light">
                  {sp.region}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>5. International transfers</h2>
      <p>
        Some subprocessors (Anthropic, Railway, Resend, Google) are based in the United
        States. Where we transfer personal data outside the EEA / United Kingdom, we rely
        on the European Commission&apos;s Standard Contractual Clauses (and equivalent UK
        IDTA) as the transfer mechanism, supplemented by encryption in transit and at rest.
      </p>

      <h2>6. How long we keep data</h2>
      <ul>
        <li>
          <strong>Account &amp; project content:</strong> for as long as your account is
          active. Deleted immediately on account deletion request, except backups (purged
          within 30 days).
        </li>
        <li>
          <strong>Billing records:</strong> retained for the period required by tax law
          (typically 5–10 years).
        </li>
        <li>
          <strong>Server &amp; AI-operation logs:</strong> 90 days, then deleted or
          anonymised.
        </li>
      </ul>

      <h2>7. Your rights</h2>
      <p>Under GDPR, KVKK (Türkiye), and similar laws, you have the right to:</p>
      <ul>
        <li>access the personal data we hold about you,</li>
        <li>correct inaccurate data,</li>
        <li>delete your data (the &quot;right to be forgotten&quot;),</li>
        <li>restrict or object to processing,</li>
        <li>receive your data in a portable, machine-readable format,</li>
        <li>withdraw consent (where consent is the legal basis),</li>
        <li>lodge a complaint with your supervisory authority (in the EU/UK) or the Personal Data Protection Authority of Türkiye (KVKK Kurumu).</li>
      </ul>
      <p>
        To exercise any right, email{' '}
        <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. We respond
        within 30 days.
      </p>

      <h2>8. Cookies</h2>
      <p>
        We use a single first-party session cookie to keep you signed in. We do not use
        third-party advertising or analytics cookies. The Paddle checkout iframe sets
        cookies necessary for payment fraud-prevention; see{' '}
        <a href="https://www.paddle.com/legal/cookies" target="_blank" rel="noopener noreferrer">
          Paddle&apos;s cookie policy
        </a>
        .
      </p>

      <h2>9. Security</h2>
      <p>
        We protect personal data with TLS 1.2+ in transit, encryption at rest in the
        database, role-based access control for engineering, and regular dependency
        patching. No system is 100% secure; we will notify affected users without undue
        delay if a breach affects their personal data.
      </p>

      <h2>10. Children</h2>
      <p>
        The Service is not directed to children under 16. If you believe a child has
        provided us with personal data, contact us and we will delete it.
      </p>

      <h2>11. Changes</h2>
      <p>
        We will post material updates here and notify active users at least 14 days before
        they take effect.
      </p>

      <h2>12. Contact</h2>
      <p>
        For privacy questions or to exercise your rights, email{' '}
        <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. The data
        controller is {LEGAL.legalEntity}, {LEGAL.legalAddress}.
      </p>
    </LegalShell>
  )
}
