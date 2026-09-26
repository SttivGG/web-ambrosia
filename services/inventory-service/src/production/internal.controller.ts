import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Inject,
  Headers,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@ambrosia/nest-auth';
import {
  productionStockRequestV1Schema,
  productionIdV1Schema,
} from '@ambrosia/contracts';
import { timingSafeEqual } from 'node:crypto';
import { ProductionStockService } from './production-stock.service';
import { PrismaService } from '../prisma.service';
import { parse } from '../purchases/domain';
export function internalAuth(
  header: string | undefined,
  cookie: string | undefined,
) {
  const key = process.env.PRODUCTION_INVENTORY_TOKEN;
  if (
    !key ||
    key.length < 64 ||
    cookie ||
    !header ||
    Buffer.byteLength(header) !== Buffer.byteLength(key) + 7 ||
    !timingSafeEqual(Buffer.from(header), Buffer.from('Bearer ' + key))
  )
    throw new UnauthorizedException();
}
@ApiExcludeController()
@Controller({ path: 'internal/production', version: '1' })
export class ProductionInternalController {
  constructor(
    @Inject(ProductionStockService)
    private readonly service: ProductionStockService,
    @Inject(PrismaService) private readonly db: PrismaService,
  ) {}
  @Public()
  @Post('operations')
  @HttpCode(200)
  execute(
    @Headers('authorization') token: string,
    @Headers('cookie') cookie: string,
    @Body() body: unknown,
  ) {
    internalAuth(token, cookie);
    return this.service.execute(parse(productionStockRequestV1Schema, body));
  }
  @Public()
  @Get('operations/:id')
  get(
    @Headers('authorization') token: string,
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
  ) {
    internalAuth(token, cookie);
    return this.service.get(parse(productionIdV1Schema, id));
  }
  @Public()
  @Get('items/:id')
  async item(
    @Headers('authorization') token: string,
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
  ) {
    internalAuth(token, cookie);
    return this.db.catalogItem.findUnique({
      where: { id: parse(productionIdV1Schema, id) },
      select: {
        id: true,
        name: true,
        itemType: true,
        inventoryBaseUnit: true,
        trackInventory: true,
        active: true,
        nominalCapacityValue: true,
        nominalCapacityUnit: true,
      },
    });
  }
}
