const SESSION_COOKIE = 'dev_session'
const SESSION_PAYLOAD = 'actual-ai-authenticated-v1'

const encoder = new TextEncoder()

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }

  return difference === 0
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return new Uint8Array(digest)
}

export async function passwordMatches(candidate: string, actualPassword: string) {
  const [candidateHash, passwordHash] = await Promise.all([
    hash(candidate),
    hash(actualPassword),
  ])

  return constantTimeEqual(candidateHash, passwordHash)
}

export async function createSessionToken(password: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(SESSION_PAYLOAD),
  )

  return toBase64Url(new Uint8Array(signature))
}

export async function isValidSessionToken(
  token: string | undefined,
  password: string | undefined,
) {
  if (!token || !password) return false

  const expectedToken = await createSessionToken(password)
  return constantTimeEqual(encoder.encode(token), encoder.encode(expectedToken))
}

export { SESSION_COOKIE }
