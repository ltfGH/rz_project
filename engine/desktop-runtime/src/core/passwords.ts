import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error('Password must contain at least eight characters.');
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, digest: string): Promise<boolean> {
  try {
    const [algorithm, nText, rText, pText, saltText, keyText, extra] = digest.split('$');
    if (algorithm !== 'scrypt' || extra !== undefined || !nText || !rText || !pText || !saltText || !keyText) {
      return false;
    }
    const n = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    if (n !== N || r !== R || p !== P) return false;
    const salt = Buffer.from(saltText, 'base64');
    const expected = Buffer.from(keyText, 'base64');
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await derive(password, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
