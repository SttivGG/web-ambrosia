import { Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
@Injectable()
export class LoginRateLimit {
  private readonly entries = new Map<
    string,
    { count: number; until: number }
  >();
  constructor(private readonly config: ConfigService) {}
  check(ip: string) {
    const now = Date.now();
    for (const [key, value] of this.entries) {
      if (value.until <= now) this.entries.delete(key);
    }
    let entry = this.entries.get(ip);
    if (!entry) {
      if (this.entries.size >= 10000)
        throw new HttpException('Solicitud rechazada', 429);
      entry = {
        count: 0,
        until:
          now +
          this.config.getOrThrow<number>('AUTH_LOGIN_RATE_WINDOW_SECONDS') *
            1000,
      };
      this.entries.set(ip, entry);
    }
    entry.count++;
    if (entry.count > this.config.getOrThrow<number>('AUTH_LOGIN_RATE_LIMIT'))
      throw new HttpException('Solicitud rechazada', 429);
  }
}
