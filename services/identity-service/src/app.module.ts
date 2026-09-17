import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateIdentityEnv } from './config/env';
import { PrismaService } from './database/prisma.service';
import { EventBusService } from './event-bus/event-bus.service';
import { HealthController } from './health/health.controller';
import { AuthController, JwksController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { KeysService } from './auth/keys.service';
import { CsrfService } from './auth/csrf.service';
import { LoginRateLimit } from './auth/rate-limit.service';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateIdentityEnv,
    }),
  ],
  controllers: [HealthController, AuthController, JwksController],
  providers: [
    PrismaService,
    EventBusService,
    AuthService,
    KeysService,
    CsrfService,
    LoginRateLimit,
  ],
})
export class AppModule {}
