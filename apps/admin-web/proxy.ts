import { NextRequest, NextResponse } from 'next/server';
import { safeReturnTo } from './lib/auth/return-to';
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const publicRoute =
    ['/', '/login', '/forbidden', '/health/live', '/favicon.ico'].includes(
      path,
    ) ||
    path.startsWith('/_next/') ||
    path.startsWith('/api/');
  let response: NextResponse;
  // Binding is only a recovery hint; refresh is HttpOnly and scoped to /api/auth.
  if (
    !publicRoute &&
    !request.cookies.has('ambrosia_access') &&
    !request.cookies.has('ambrosia_csrf_bind')
  ) {
    const target = new URL('/login', request.url);
    target.searchParams.set(
      'returnTo',
      safeReturnTo(path + request.nextUrl.search),
    );
    response = NextResponse.redirect(target);
  } else response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
