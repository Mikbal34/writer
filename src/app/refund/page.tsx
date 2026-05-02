import Link from 'next/link'
import { LegalShell } from '@/components/marketing/MarketingFrame'
import { LEGAL } from '@/lib/legal-config'

export const metadata = {
  title: 'Refund Policy — Quilpen',
  description:
    'Quilpen refund policy: 14-day money-back guarantee for first-time Pro subscribers.',
}

export default function RefundPage() {
  return (
    <LegalShell title="Refund Policy">
      <p>
        We want you to be confident about subscribing to {LEGAL.brand}. This policy
        explains when refunds are available and how to request one. Payments are processed
        by our Merchant of Record, Paddle, and refunds are issued back to the original
        payment method through Paddle.
      </p>

      <h2>1. Free tier</h2>
      <p>
        The Free plan is — well — free. There is nothing to refund. Use it for as long as
        you like before deciding to upgrade.
      </p>

      <h2>2. 14-day money-back guarantee (first-time paid subscribers)</h2>
      <p>
        If you are upgrading to a paid plan (Starter or Pro) for the first time, you may
        request a full refund within <strong>14 days</strong> of the initial charge — no
        questions asked, even if you have already used some credits during that period.
      </p>
      <p>
        This 14-day guarantee applies only to your first paid subscription on a given
        account. Subsequent renewals and tier upgrades are governed by sections 3 and 4.
      </p>

      <h2>3. Renewals &amp; subsequent billing periods</h2>
      <p>
        Subscriptions renew automatically until cancelled. To avoid being charged for a
        new month or year, cancel <strong>before</strong> the renewal date from your
        account page. Cancellations stop future billing; access continues until the end of
        the current paid period.
      </p>
      <p>
        Refunds for renewal charges are not provided as a matter of course. We may grant a
        prorated or full refund as a courtesy in cases such as:
      </p>
      <ul>
        <li>You were charged within 48 hours of a valid cancellation that did not register;</li>
        <li>Significant Service downtime or failure to deliver promised functionality during the billing period;</li>
        <li>Duplicate or accidental charges.</li>
      </ul>

      <h2>4. Annual plans</h2>
      <p>
        For annual Pro plans, the 14-day guarantee in section 2 applies to the initial
        charge. After day 14, annual subscriptions are non-refundable, but you can cancel
        at any time to stop future renewals. Your access continues through the end of the
        prepaid year.
      </p>

      <h2>5. Things we do not refund</h2>
      <ul>
        <li>Credits already consumed in completed AI operations (the underlying compute cost has been incurred);</li>
        <li>Subscriptions cancelled <em>after</em> a renewal charge if more than 14 days have passed since that charge (outside section 3 exceptions);</li>
        <li>Accounts terminated for breach of our <Link href="/terms">Terms of Service</Link>.</li>
      </ul>

      <h2>6. Statutory rights (EU / UK consumers)</h2>
      <p>
        Where you are an EU or UK consumer, you have a statutory right under the Consumer
        Rights Directive / Consumer Rights Act 2015 to withdraw from a digital-services
        contract within 14 days of purchase. By starting to use the Service during that
        window, you expressly request immediate performance and acknowledge that, where
        the Service has been fully performed, the right of withdrawal is lost. In practice,
        because our 14-day refund in section 2 is more generous, EU/UK customers can rely
        on it without invoking the statutory right.
      </p>

      <h2>7. How to request a refund</h2>
      <ol className="list-decimal pl-6 space-y-1 text-[15px]">
        <li>
          Email <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> from the
          email address associated with your account.
        </li>
        <li>
          Include the date of the charge and the last four digits of the card used (or
          PayPal email if applicable). You can find these on the Paddle invoice.
        </li>
        <li>
          We process eligible refunds within <strong>5 business days</strong>. Paddle
          returns the funds to your original payment method; depending on your bank, the
          credit may take a further 3–10 business days to appear.
        </li>
      </ol>

      <h2>8. Chargebacks</h2>
      <p>
        If you initiate a chargeback before contacting us, we may suspend your account
        until the chargeback is resolved. We almost always prefer to resolve issues
        directly — please email us first.
      </p>

      <h2>9. Changes</h2>
      <p>
        We may update this policy from time to time. Material changes are communicated via
        email or in-product notice and take effect at least 14 days after the notice.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about refunds? Email{' '}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>. Operating entity:{' '}
        {LEGAL.legalEntity}, {LEGAL.legalAddress}.
      </p>
    </LegalShell>
  )
}
