import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Inject,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentAuth,
  RequirePermissions,
  type AuthContext,
} from '@ambrosia/nest-auth';
import { z } from 'zod';
import {
  adjustmentV1Schema,
  movementV1Schema,
  movementListV1Schema,
  stockV1Schema,
  stockListV1Schema,
  movementFiltersV1Schema,
  stockFiltersV1Schema,
} from '@ambrosia/contracts';
import { StockService } from './stock.service';
import { parse } from './domain';
import { body, responses, queries } from './openapi';
@ApiTags('Existencias y movimientos v1')
@Controller({ path: 'inventory', version: '1' })
export class StockController {
  constructor(@Inject(StockService) private readonly service: StockService) {}
  @Get('stocks')
  @RequirePermissions('inventory.read')
  @queries(stockFiltersV1Schema)
  @responses(stockListV1Schema, 'inventory.read')
  stocks(@Query() q: unknown) {
    return this.service.stocks(parse(stockFiltersV1Schema, q));
  }
  @Get('stocks/:id')
  @RequirePermissions('inventory.read')
  @responses(stockV1Schema, 'inventory.read')
  stock(@Param('id') id: string) {
    return this.service.stock(parse(z.string().uuid(), id));
  }
  @Get('movements')
  @RequirePermissions('inventory.read')
  @queries(movementFiltersV1Schema)
  @responses(movementListV1Schema, 'inventory.read')
  movements(@Query() q: unknown) {
    return this.service.movements(parse(movementFiltersV1Schema, q));
  }
  @Post('adjustments')
  @RequirePermissions('inventory.write')
  @body(adjustmentV1Schema)
  @responses(movementV1Schema, 'inventory.write', 201)
  adjust(@Body() value: unknown, @CurrentAuth() auth: AuthContext) {
    return this.service.adjust(parse(adjustmentV1Schema, value), auth.subject);
  }
}
