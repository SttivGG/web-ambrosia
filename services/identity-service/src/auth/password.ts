import { hash, verify, argon2id } from 'argon2';
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export function validPassword(password: string, email: string): boolean {
  return (
    password.length >= 12 &&
    password.length <= 128 &&
    /\p{L}/u.test(password) &&
    /\p{N}/u.test(password) &&
    normalizeEmail(password) !== normalizeEmail(email)
  );
}
export const hashPassword = (password: string) =>
  hash(password, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
export async function verifyPassword(
  encoded: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(encoded, password);
  } catch {
    return false;
  }
}
