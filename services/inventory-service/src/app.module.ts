import { PurchasesController } from './purchases/purchases.controller';
import { PurchasesService } from './purchases/purchases.service';
import { StockController } from './purchases/stock.controller';
import { StockService } from './purchases/stock.service';
import { SuppliersController } from './suppliers/suppliers.controller';
import { SuppliersService } from './suppliers/suppliers.service';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
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
          PORT: env.PORT ?? env.INVENTORY_SERVICE_PORT,
          DATABASE_URL: env.DATABASE_URL ?? env.INVENTORY_DATABASE_URL,
        }),
    }),
  ],
  controllers: [
    PurchasesController,
    StockController,
    HealthController,
    CatalogController,
    SuppliersController,
  ],
  providers: [
    PurchasesService,
    StockService,
    PrismaService,
    EventBusService,
    CatalogService,
    SuppliersService,
  ],
})
export class AppModule {}
