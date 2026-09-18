import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { publicUserV1Schema, type PublicUserV1 } from '@ambrosia/contracts';
import { identityOrigin } from './config';
export type ServerSession =
  | { status: 'authenticated'; user: PublicUserV1 }
  | { status: 'anonymous' | 'expired' | 'unavailable' | 'invalid-response' };
export const getServerSession = cache(async (): Promise<ServerSession> => {
  const jar = await cookies();
  const access = jar.getAll('ambrosia_access');
  if (access.length !== 1 || !access[0]?.value)
    return { status: jar.has('ambrosia_csrf_bind') ? 'expired' : 'anonymous' };
  try {
    const response = await fetch(
      identityOrigin(process.env.IDENTITY_INTERNAL_URL) + '/api/v1/auth/me',
      {
        headers: {
          Cookie: 'ambrosia_access=' + encodeURIComponent(access[0].value),
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      },
    );
    if (response.status === 401) return { status: 'expired' };
    if (!response.ok) return { status: 'unavailable' };
    try {
      const result = publicUserV1Schema.safeParse(await response.json());
      return result.success
        ? { status: 'authenticated', user: result.data }
        : { status: 'invalid-response' };
    } catch {
      return { status: 'invalid-response' };
    }
  } catch {
    return { status: 'unavailable' };
  }
});
