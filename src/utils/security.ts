import crypto from 'crypto';

const AUTH_HEADER = 'x-sanity-token';

const getAuthToken = () => (process.env.SANITY_GATE_TOKEN || '').trim();

export function isAuthRequired(): boolean {
  return getAuthToken().length > 0;
}

export function validateAuth(headers: Headers): void {
  if (!isAuthRequired()) return;
  const expected = getAuthToken();
  const providedHeader =
    headers.get(AUTH_HEADER) ||
    headers.get(AUTH_HEADER.toUpperCase()) ||
    headers.get('authorization') ||
    headers.get('Authorization');

  if (!providedHeader) {
    throw new Error('AUTH_ERROR: Missing token');
  }

  const provided = providedHeader.startsWith('Bearer ')
    ? providedHeader.slice(7)
    : providedHeader;

  if (provided !== expected) {
    throw new Error('AUTH_ERROR: Invalid token');
  }
}

const getSignatureSecret = () => {
  const signature = (process.env.SANITY_GATE_SIGNATURE || '').trim();
  if (signature) return signature;
  const authToken = getAuthToken();
  return authToken || '';
};

export function signPath(targetPath: string): string | null {
  const secret = getSignatureSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(targetPath).digest('hex');
}

export function verifyPathSignature(targetPath: string, signature?: string | null): boolean {
  const expected = signPath(targetPath);
  if (!expected) return true; // signature enforcement disabled
  if (!signature) return false;
  try {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(signature, 'hex');
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}
