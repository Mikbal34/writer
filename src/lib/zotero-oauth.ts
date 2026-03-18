import OAuth from 'oauth-1.0a'
import CryptoJS from 'crypto-js'

const REQUEST_TOKEN_URL = 'https://www.zotero.org/oauth/request'
const AUTHORIZE_URL = 'https://www.zotero.org/oauth/authorize'
const ACCESS_TOKEN_URL = 'https://www.zotero.org/oauth/access'

function getConsumer() {
  const key = process.env.ZOTERO_CLIENT_KEY
  const secret = process.env.ZOTERO_CLIENT_SECRET
  if (!key || !secret) {
    throw new Error('ZOTERO_CLIENT_KEY and ZOTERO_CLIENT_SECRET env vars are required')
  }
  return { key, secret }
}

function createOAuth() {
  return new OAuth({
    consumer: getConsumer(),
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return CryptoJS.HmacSHA1(baseString, key).toString(CryptoJS.enc.Base64)
    },
  })
}

function getCallbackUrl() {
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  return `${base}/api/library/zotero/callback`
}

/**
 * Step 1: Get a request token from Zotero
 */
export async function getRequestToken(): Promise<{
  oauthToken: string
  oauthTokenSecret: string
  authorizeUrl: string
}> {
  const oauth = createOAuth()

  const requestData = {
    url: REQUEST_TOKEN_URL,
    method: 'POST' as const,
    data: { oauth_callback: getCallbackUrl() },
  }

  const authHeader = oauth.toHeader(oauth.authorize(requestData))

  const res = await fetch(REQUEST_TOKEN_URL, {
    method: 'POST',
    headers: {
      ...authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `oauth_callback=${encodeURIComponent(getCallbackUrl())}`,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to get request token: ${res.status} ${text}`)
  }

  const body = await res.text()
  const params = new URLSearchParams(body)
  const oauthToken = params.get('oauth_token')
  const oauthTokenSecret = params.get('oauth_token_secret')

  if (!oauthToken || !oauthTokenSecret) {
    throw new Error('Invalid request token response')
  }

  const authorizeUrl = `${AUTHORIZE_URL}?oauth_token=${oauthToken}&library_access=1&all_groups=read`

  return { oauthToken, oauthTokenSecret, authorizeUrl }
}

/**
 * Step 3: Exchange request token + verifier for access token
 */
export async function getAccessToken(
  oauthToken: string,
  oauthTokenSecret: string,
  oauthVerifier: string
): Promise<{
  accessToken: string
  accessTokenSecret: string
  zoteroUserId: string
  username: string
}> {
  const oauth = createOAuth()

  const requestData = {
    url: ACCESS_TOKEN_URL,
    method: 'POST' as const,
    data: { oauth_verifier: oauthVerifier },
  }

  const token = { key: oauthToken, secret: oauthTokenSecret }
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token))

  const res = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      ...authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `oauth_verifier=${encodeURIComponent(oauthVerifier)}`,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to get access token: ${res.status} ${text}`)
  }

  const body = await res.text()
  const params = new URLSearchParams(body)

  const accessToken = params.get('oauth_token')
  const accessTokenSecret = params.get('oauth_token_secret')
  const zoteroUserId = params.get('userID')
  const username = params.get('username')

  if (!accessToken || !zoteroUserId) {
    throw new Error('Invalid access token response')
  }

  return {
    accessToken,
    accessTokenSecret: accessTokenSecret ?? '',
    zoteroUserId,
    username: username ?? '',
  }
}
