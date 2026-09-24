import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Inject,
  HttpCode,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentAuth,
  RequirePermissions,
  type AuthContext,
} from '@ambrosia/nest-auth';
import { z } from 'zod';
import {
  createPurchaseV1Schema,
  updatePurchaseV1Schema,
  cancelPurchaseV1Schema,
  purchaseFiltersV1Schema,
  purchaseV1Schema,
  purchaseListV1Schema,
  versionV1Schema,
} from '@ambrosia/contracts';
import { PurchasesService } from './purchases.service';
import { parse } from './domain';
import { body, responses, queries } from './openapi';
const idSchema = z.string().uuid();
@ApiTags('Compras v1')
@Controller({ path: 'purchases', version: '1' })
export class PurchasesController {
  constructor(
    @Inject(PurchasesService) private readonly service: PurchasesService,
  ) {}
  @Get()
  @RequirePermissions('purchases.read')
  @queries(purchaseFiltersV1Schema)
  @responses(purchaseListV1Schema, 'purchases.read')
  list(@Query() q: unknown) {
    return this.service.list(parse(purchaseFiltersV1Schema, q));
  }
  @Get(':id')
  @RequirePermissions('purchases.read')
  @responses(purchaseV1Schema, 'purchases.read')
  get(@Param('id') id: string) {
    return this.service.get(parse(idSchema, id));
  }
  @Post()
  @RequirePermissions('purchases.write')
  @body(createPurchaseV1Schema, {
    supplierId: '11111111-1111-4111-8111-111111111111',
    reference: 'COMPRA-2026-001',
    purchasedAt: '2026-09-22T15:00:00.000Z',
    lines: [
      {
        itemId: '22222222-2222-4222-8222-222222222222',
        quantity: '2.5',
        unitCost: '1200.50',
      },
    ],
  })
  @responses(purchaseV1Schema, 'purchases.write', 201)
  create(@Body() value: unknown) {
    return this.service.create(parse(createPurchaseV1Schema, value));
  }
  @Patch(':id')
  @RequirePermissions('purchases.write')
  @body(updatePurchaseV1Schema)
  @responses(purchaseV1Schema, 'purchases.write')
  update(@Param('id') id: string, @Body() value: unknown) {
    return this.service.update(
      parse(idSchema, id),
      parse(updatePurchaseV1Schema, value),
    );
  }
  @Post(':id/receive')
  @HttpCode(200)
  @RequirePermissions('purchases.write')
  @body(versionV1Schema)
  @responses(purchaseV1Schema, 'purchases.write')
  receive(
    @Param('id') id: string,
    @Body() value: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.service.receive(
      parse(idSchema, id),
      parse(versionV1Schema, value).expectedVersion,
      auth.subject,
    );
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('purchases.write')
  @body(cancelPurchaseV1Schema)
  @responses(purchaseV1Schema, 'purchases.write')
  cancel(
    @Param('id') id: string,
    @Body() value: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const data = parse(cancelPurchaseV1Schema, value);
    return this.service.cancel(
      parse(idSchema, id),
      data.expectedVersion,
      data.reason,
      auth.subject,
    );
  }
}
