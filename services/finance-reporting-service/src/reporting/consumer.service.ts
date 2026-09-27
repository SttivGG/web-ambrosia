import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventBusService } from '../event-bus.service';
import { ReportingService } from './reporting.service';

@Injectable()
export class ReportingConsumerService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(ReportingConsumerService.name);
  constructor(
    private readonly events: EventBusService,
    private readonly reporting: ReportingService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.start(), 2_000);
    void this.start();
  }
  private async start() {
    try {
      await this.events.startReportingConsumer(async (subject, value) => {
        await this.reporting.apply(subject, value);
      });
    } catch (error) {
      const detail = error instanceof Error ? ': ' + error.message : '';
      this.logger.warn(
        'Consumidor de Reporting no disponible; reintentando' + detail,
      );
    }
  }
  isReady() {
    return this.events.isReportingReady();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
