import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateServiceEnv } from '@ambrosia/shared-config';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { EventBusService } from './event-bus.service';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: (env) =>
        validateServiceEnv({
          ...env,
          PORT: env.PORT ?? env.PRODUCTION_SERVICE_PORT,
          DATABASE_URL: env.DATABASE_URL ?? env.PRODUCTION_DATABASE_URL,
        }),
    }),
  ],
  controllers: [HealthController],
  providers: [PrismaService, EventBusService],
})
export class AppModule {}
