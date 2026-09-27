import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@ambrosia/nest-auth';
import {
  purchaseSnapshotV1Schema,
  saleStockRequestV1Schema,
  saleableItemFiltersV1Schema,
} from '@ambrosia/contracts';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { parse } from '../purchases/domain';
import { SaleStockService } from './sale-stock.service';

export function financeInternalAuth(header?: string, cookie?: string) {
  const key = process.env.FINANCE_INVENTORY_TOKEN;
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
@Controller({ path: 'internal/finance', version: '1' })
export class FinanceInternalController {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(SaleStockService) private readonly sales: SaleStockService,
  ) {}
  private authorize(token?: string, cookie?: string) {
    financeInternalAuth(token, cookie);
  }

  @Public()
  @Get('purchases/:id')
  async purchase(
    @Headers('authorization') token: string,
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
  ) {
    this.authorize(token, cookie);
    const row = await this.db.purchase.findUnique({
      where: { id },
      include: { supplier: true },
    });
    if (!row) return null;
    return purchaseSnapshotV1Schema.parse({
      id: row.id,
      reference: row.reference,
      status: row.status,
      total: row.total.toFixed(),
      currency: row.currency,
      supplier: {
        id: row.supplier.id,
        code: row.supplier.code,
        name: row.supplier.name,
      },
      purchasedAt: row.purchasedAt.toISOString(),
      receivedAt: row.receivedAt?.toISOString() ?? null,
      version: row.version,
    });
  }

  @Public()
  @Get('saleable-items/:id')
  async item(
    @Headers('authorization') token: string,
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
  ) {
    this.authorize(token, cookie);
    const row = await this.db.catalogItem.findUnique({
      where: { id },
      include: { balance: true },
    });
    if (
      !row ||
      !row.active ||
      !row.trackInventory ||
      row.itemType !== 'FINISHED_PRODUCT' ||
      row.inventoryBaseUnit !== 'UNIT'
    )
      return null;
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      active: row.active,
      availableQuantity: row.balance?.quantity.toFixed() ?? '0',
    };
  }

  @Public()
  @Get('saleable-items')
  async items(
    @Headers('authorization') token: string,
    @Headers('cookie') cookie: string,
    @Query() query: unknown,
  ) {
    this.authorize(token, cookie);
    const q = parse(saleableItemFiltersV1Schema, query);
    const where = {
      active: true,
      trackInventory: true,
      itemType: 'FINISHED_PRODUCT' as const,
      inventoryBaseUnit: 'UNIT' as const,
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { sku: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.db.$transaction(
      [
        this.db.catalogItem.findMany({
          where,
          include: { balance: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        this.db.catalogItem.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: rows.map((row) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        active: row.active,
        availableQuantity: row.balance?.quantity.toFixed() ?? '0',
      })),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / q.pageSize),
      },
    };
  }

  @Public()
  @Post('sales/operations')
  @HttpCode(200)
  execute(
    @Headers('authorization') token: string,
    @Headers('cookie') cookie: string,
    @Body() body: unknown,
  ) {
    this.authorize(token, cookie);
    return this.sales.execute(parse(saleStockRequestV1Schema, body));
  }
}
