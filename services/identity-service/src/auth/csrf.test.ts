import { describe, it, expect } from 'vitest';
import { safeEqual, readCookie } from './csrf.service';
describe('CSRF', () => {
  it('comparación segura', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('a', 'long')).toBe(false);
  });
  it('rechaza cookies duplicadas y decodifica una', () => {
    expect(
      readCookie(
        { headers: { cookie: 'ambrosia_csrf=a; ambrosia_csrf=b' } } as never,
        'ambrosia_csrf',
      ),
    ).toBeUndefined();
    expect(
      readCookie(
        { headers: { cookie: 'other=x; ambrosia_csrf=a%20b' } } as never,
        'ambrosia_csrf',
      ),
    ).toBe('a b');
  });
});
