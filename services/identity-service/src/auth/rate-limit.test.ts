import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { LoginRateLimit } from './rate-limit.service';

describe('rate limit de login', () => {
  it('limita por IP sin afectar otra dirección', () => {
    const config = {
      getOrThrow: (key: string) => (key === 'AUTH_LOGIN_RATE_LIMIT' ? 2 : 60),
    } as ConfigService;
    const limit = new LoginRateLimit(config);

    limit.check('192.0.2.1');
    limit.check('192.0.2.1');
    expect(() => limit.check('192.0.2.1')).toThrowError(
      expect.objectContaining({ status: 429 }),
    );
    expect(() => limit.check('192.0.2.2')).not.toThrow();
  });
});
