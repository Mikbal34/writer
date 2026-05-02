import Link from 'next/link'
import { LegalShell } from '@/components/marketing/MarketingFrame'
import { LEGAL } from '@/lib/legal-config'

export const metadata = {
  title: 'Terms of Service — Quilpen',
  description: 'Terms governing the use of Quilpen, the AI-assisted academic writing platform.',
}

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of {LEGAL.brand}{' '}
        (&quot;the Service&quot;), operated by {LEGAL.legalEntity} (&quot;we&quot;, &quot;us&quot;,
        &quot;our&quot;). By creating an account or using the Service, you agree to these Terms.
        If you do not agree, do not use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        {LEGAL.brand} is a web-based platform that helps users plan, draft, and export
        academic manuscripts using AI assistance. Features include AI-assisted writing,
        bibliography management, nine citation formats, and export to DOCX, PDF, and EPUB.
        We may add, remove, or modify features at any time.
      </p>

      <h2>2. Eligibility &amp; accounts</h2>
      <p>
        You must be at least 16 years old (or the minimum legal age in your jurisdiction) to
        use the Service. You are responsible for safeguarding your account credentials and
        for all activity under your account. Notify us immediately of unauthorised use.
      </p>

      <h2>3. Subscriptions, billing &amp; credits</h2>
      <p>
        The Service is offered on a free tier and on paid monthly or annual subscriptions
        (currently &quot;Starter&quot; and &quot;Pro&quot;). See our{' '}
        <Link href="/pricing">pricing page</Link> for current plans and credit allowances.
      </p>
      <ul>
        <li>
          Subscriptions renew automatically at the end of each billing period until cancelled.
        </li>
        <li>
          Credits granted in a billing period do not carry over to subsequent periods.
        </li>
        <li>
          Prices are listed in USD. Local taxes (VAT, sales tax, etc.) are added at checkout
          where applicable.
        </li>
        <li>
          Payments are processed by our Merchant of Record, {LEGAL.paymentProcessor} (Paddle).
          Paddle&apos;s terms apply to the payment transaction itself; see{' '}
          <a href="https://www.paddle.com/legal/checkout-buyer-terms" target="_blank" rel="noopener noreferrer">
            paddle.com/legal/checkout-buyer-terms
          </a>
          .
        </li>
        <li>
          Refunds are governed by our <Link href="/refund">refund policy</Link>.
        </li>
      </ul>

      <h2>4. Your content &amp; ownership</h2>
      <p>
        You retain all rights, title, and interest in any text, citations, manuscripts, or
        files you upload, generate, or export through the Service (&quot;Your Content&quot;).
        We do not claim ownership of Your Content.
      </p>
      <p>
        You grant us a limited, non-exclusive licence to host, store, transmit, and display
        Your Content solely as necessary to operate and improve the Service for you. We do
        not use Your Content to train AI models.
      </p>

      <h2>5. AI-generated output</h2>
      <p>
        The Service uses third-party large language models (currently Anthropic Claude) to
        produce text and structural suggestions. AI output may contain inaccuracies,
        fabricated references, or biased material. You are solely responsible for reviewing,
        editing, and verifying any AI output before relying on it, citing it, or submitting
        it for academic credit, publication, or any other purpose.
      </p>
      <p>
        Outputs are not guaranteed to be unique. Identical or similar prompts may produce
        similar text for other users. You are responsible for ensuring your final manuscript
        complies with your institution&apos;s academic-integrity rules and any applicable
        publishing guidelines.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>Violate any law or third-party right, including copyright and privacy rights;</li>
        <li>Generate content that is unlawful, defamatory, harassing, or sexually explicit involving minors;</li>
        <li>Attempt to reverse-engineer, scrape, or overload the Service;</li>
        <li>Resell or redistribute the Service without our written consent;</li>
        <li>Submit content that you do not have the right to upload (e.g. copyrighted source PDFs you do not own or licence).</li>
      </ul>
      <p>
        We may suspend or terminate accounts that violate this section.
      </p>

      <h2>7. Termination</h2>
      <p>
        You may cancel your subscription at any time from your account page; access continues
        until the end of the current billing period. We may suspend or terminate your access
        if you breach these Terms or if continued provision of the Service becomes
        impractical. On termination, you may export Your Content for a reasonable period
        before deletion.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS.
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR
        IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
        NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR
        FREE, OR THAT AI OUTPUT WILL BE ACCURATE.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY ARISING FROM OR RELATED
        TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE FEES YOU PAID US IN THE
        TWELVE MONTHS PRECEDING THE CLAIM, OR (B) USD 100. WE WILL NOT BE LIABLE FOR
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOSS OF
        DATA, PROFITS, OR GOODWILL.
      </p>

      <h2>10. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be communicated
        by email or in-product notice at least 14 days before they take effect. Continued
        use of the Service after the effective date constitutes acceptance.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These Terms are governed by the laws of {LEGAL.legalEntityCountry}, without regard
        to its conflict-of-law principles. The courts of İstanbul, {LEGAL.legalEntityCountry}{' '}
        have exclusive jurisdiction over any dispute, except that consumers may bring claims
        in their place of residence where required by mandatory local law.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these Terms? Email{' '}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>. The legal entity
        operating the Service is {LEGAL.legalEntity}, registered in {LEGAL.legalAddress}.
      </p>
    </LegalShell>
  )
}
