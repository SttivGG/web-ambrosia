import { NestAuthModule, authOptions } from '@ambrosia/nest-auth';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateServiceEnv } from '@ambrosia/shared-config';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { EventBusService } from './event-bus.service';
@Module({
  imports: [
    NestAuthModule.register(authOptions(process.env)),
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: (env) =>
        validateServiceEnv({
          ...env,
          PORT: env.PORT ?? env.FINANCE_REPORTING_SERVICE_PORT,
          DATABASE_URL: env.DATABASE_URL ?? env.FINANCE_REPORTING_DATABASE_URL,
        }),
    }),
  ],
  controllers: [HealthController],
  providers: [PrismaService, EventBusService],
})
export class AppModule {}
