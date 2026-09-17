import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const target = 'secrets/auth.local.env';
if (existsSync(target) && !process.argv.includes('--force'))
  throw new Error(
    target + ' ya existe. Use --force solo para una rotación planificada.',
  );
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
mkdirSync('secrets', { recursive: true });
writeFileSync(
  target,
  [
    `JWT_PRIVATE_KEY_BASE64=${Buffer.from(privateKey).toString('base64')}`,
    `JWT_PUBLIC_KEY_BASE64=${Buffer.from(publicKey).toString('base64')}`,
    `AUTH_CSRF_SECRET=${randomBytes(48).toString('base64url')}`,
    '',
  ].join('\n'),
  { mode: 0o600, flag: 'w' },
);
process.stdout.write(
  `Claves RSA de 3072 bits y secreto CSRF escritos una vez en ${target}.\n` +
    'El archivo está ignorado por Git. Compose y pnpm dev lo cargan directamente.\n',
);
