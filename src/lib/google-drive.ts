import { google } from 'googleapis'
import { Readable } from 'stream'
import { prisma } from '@/lib/db'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
)

/**
 * Creates an authenticated OAuth2 client for the given user.
 * Refreshes the access token if expired and persists the new tokens.
 */
export async function getOAuth2Client(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'google' },
  })

  if (!account?.access_token) {
    throw new DriveAuthError('Google account is not connected. Please sign out and sign in again.')
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )

  client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  })

  // Check if token is expired (expires_at is in seconds)
  const now = Math.floor(Date.now() / 1000)
  if (account.expires_at && account.expires_at < now) {
    if (!account.refresh_token) {
      throw new DriveAuthError('Token has expired and no refresh token is available. Please sign out and sign in again.')
    }
    const { credentials } = await client.refreshAccessToken()
    client.setCredentials(credentials)

    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token ?? account.refresh_token,
        expires_at: credentials.expiry_date
          ? Math.floor(credentials.expiry_date / 1000)
          : account.expires_at,
      },
    })
  }

  return client
}

interface UploadParams {
  userId: string
  fileName: string
  mimeType: string
  buffer: Buffer
  convertToGoogleDocs?: boolean
}

/**
 * Uploads a file to Google Drive. Optionally converts DOCX to Google Docs format.
 * Returns the file ID and web view link.
 */
export async function uploadToGoogleDrive({
  userId,
  fileName,
  mimeType,
  buffer,
  convertToGoogleDocs = false,
}: UploadParams) {
  const auth = await getOAuth2Client(userId)
  const drive = google.drive({ version: 'v3', auth })

  const requestBody: { name: string; mimeType?: string } = { name: fileName }

  // If converting DOCX → Google Docs, set the target mimeType
  if (convertToGoogleDocs) {
    requestBody.mimeType = 'application/vnd.google-apps.document'
  }

  const stream = Readable.from(buffer)

  const res = await drive.files.create({
    requestBody,
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id,webViewLink',
  })

  return {
    fileId: res.data.id!,
    webViewLink: res.data.webViewLink!,
  }
}

export class DriveAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DriveAuthError'
  }
}
