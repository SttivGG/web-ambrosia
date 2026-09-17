import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, JSONCodec, NatsConnection } from 'nats';
import type { EventEnvelopeV1 } from '@ambrosia/contracts';
@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private connection?: NatsConnection;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly logger = new Logger(EventBusService.name);
  constructor(private readonly config: ConfigService) {}
  onModuleInit() {
    void this.open();
  }
  private async open(): Promise<void> {
    try {
      const connection = await connect({
        servers: this.config.getOrThrow<string>('NATS_URL'),
        user: this.config.getOrThrow<string>('NATS_USER'),
        pass: this.config.getOrThrow<string>('NATS_PASSWORD'),
        name: 'production-service',
        timeout: 1500,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 1000,
      });
      if (this.stopped) {
        await connection.close();
        return;
      }
      this.connection = connection;
      void this.observe(connection);
      void connection.closed().then(() => {
        if (!this.stopped) this.schedule();
      });
    } catch {
      this.logger.warn('NATS no disponible; reintentando');
      this.schedule();
    }
  }
  private schedule() {
    if (!this.stopped) this.timer = setTimeout(() => void this.open(), 2000);
  }
  private async observe(connection: NatsConnection) {
    for await (const event of connection.status()) {
      this.logger.log({ event: 'nats.' + event.type });
    }
  }
  async isReady(): Promise<boolean> {
    try {
      if (!this.connection || this.connection.isClosed()) return false;
      const manager = await this.connection.jetstreamManager({ timeout: 1500 });
      await manager.getAccountInfo();
      return true;
    } catch {
      return false;
    }
  }
  async publish<T>(subject: string, event: EventEnvelopeV1<T>): Promise<void> {
    if (!this.connection) throw new Error('Bus no disponible');
    await this.connection
      .jetstream({ timeout: 1500 })
      .publish(subject, JSONCodec<EventEnvelopeV1<T>>().encode(event), {
        msgID: event.id,
      });
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    const connection = this.connection;
    if (!connection) return;
    const timer = setTimeout(() => void connection.close(), 2000);
    try {
      await connection.drain();
    } catch {
      await connection.close();
    } finally {
      clearTimeout(timer);
    }
  }
}
