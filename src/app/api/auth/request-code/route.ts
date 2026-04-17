import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { hashCode, generateCode } from '@/lib/auth-code'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'Quilpen <onboarding@resend.dev>'

function renderCodeEmail(code: string): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F0E6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E6;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#FAF7F0;border:1px solid #d4c9b5;border-radius:4px;padding:40px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#2D1F0E;">Quilpen</div>
          <div style="width:24px;height:2px;background:#C9A84C;margin:12px auto;"></div>
        </td></tr>
        <tr><td align="center" style="padding:16px 0 8px;font-size:14px;color:#6b5a45;">
          Giris kodunuz
        </td></tr>
        <tr><td align="center" style="padding:8px 0 24px;">
          <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#2D1F0E;background:#F5F0E6;padding:16px 24px;border-radius:4px;border:1px solid #d4c9b5;display:inline-block;">${code}</div>
        </td></tr>
        <tr><td align="center" style="font-size:12px;color:#8a7a65;padding-bottom:8px;">
          Kod <strong>10 dakika</strong> gecerlidir.
        </td></tr>
        <tr><td style="font-size:11px;color:#a89a82;line-height:1.5;padding-top:24px;border-top:1px solid #e8e2d8;">
          Bu istegi siz baslatmadiysaniz goz ardi edebilirsiniz.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string }
    const email = body.email?.trim().toLowerCase()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Gecerli bir e-posta gir' }, { status: 400 })
    }

    if (!resend) {
      console.error('[request-code] RESEND_API_KEY missing')
      return NextResponse.json({ error: 'Mail servisi yapilandirilmamis' }, { status: 500 })
    }

    const code = generateCode()
    const hash = hashCode(code, email)
    const expires = new Date(Date.now() + 10 * 60 * 1000) // 10 min

    // One active code per email at a time
    await prisma.verificationToken.deleteMany({ where: { identifier: email } })
    await prisma.verificationToken.create({
      data: { identifier: email, token: hash, expires },
    })

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Quilpen giris kodu: ${code}`,
      text: `Quilpen giris kodunuz: ${code}\n\nKod 10 dakika gecerlidir. Bu istegi siz baslatmadiysaniz goz ardi edebilirsiniz.\n`,
      html: renderCodeEmail(code),
    })
    if (error) {
      console.error('[request-code] Resend failed:', error)
      return NextResponse.json({ error: 'Mail gonderilemedi' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/auth/request-code]', err)
    return NextResponse.json({ error: 'Sunucu hatasi' }, { status: 500 })
  }
}
