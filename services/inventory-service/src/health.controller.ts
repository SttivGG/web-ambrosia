import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { HealthV1 } from '@ambrosia/contracts';
import { PrismaService } from './prisma.service';
import { EventBusService } from './event-bus.service';
class DependenciesDto {
  @ApiProperty() database!: boolean;
  @ApiProperty() nats!: boolean;
}
class HealthDto {
  @ApiProperty({ example: 'inventory-service' }) service!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty({ type: DependenciesDto, required: false })
  dependencies?: DependenciesDto;
}
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
  ) {}
  @Get('live')
  @ApiOkResponse({ type: HealthDto })
  live(): HealthV1 {
    return {
      service: 'inventory-service',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
  @Get('ready')
  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse({ type: HealthDto })
  async ready(): Promise<HealthV1> {
    const [database, nats] = await Promise.all([
      this.prisma.isReady(),
      this.events.isReady(),
    ]);
    const result: HealthV1 = {
      ...this.live(),
      status: database && nats ? 'ok' : 'unavailable',
      dependencies: { database, nats },
    };
    if (!database || !nats) throw new ServiceUnavailableException(result);
    return result;
  }
}
