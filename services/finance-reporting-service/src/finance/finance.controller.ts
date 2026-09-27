import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentAuth,
  RequirePermissions,
  type AuthContext,
} from '@ambrosia/nest-auth';
import {
  accountFiltersV1Schema,
  accountVersionV1Schema,
  cancelSaleV1Schema,
  createMoneyAccountV1Schema,
  createSaleV1Schema,
  financeMovementListV1Schema,
  financeMovementV1Schema,
  manualMovementInputV1Schema,
  moneyAccountListV1Schema,
  moneyAccountV1Schema,
  financeMovementFiltersV1Schema,
  paymentFiltersV1Schema,
  purchasePaymentInputV1Schema,
  purchasePaymentListV1Schema,
  purchasePaymentV1Schema,
  regularizePaymentV1Schema,
  saleFiltersV1Schema,
  saleListV1Schema,
  saleV1Schema,
  saleableItemFiltersV1Schema,
  saleableItemListV1Schema,
  updateMoneyAccountV1Schema,
} from '@ambrosia/contracts';
import { FinanceService } from './finance.service';
import { parse } from './domain';
import { body, queries, responses } from './openapi';

@ApiTags('Finanzas v1')
@Controller({ path: 'finance', version: '1' })
export class FinanceController {
  constructor(
    @Inject(FinanceService) private readonly service: FinanceService,
  ) {}
  @Get('accounts')
  @RequirePermissions('finance.read')
  @queries(accountFiltersV1Schema)
  @responses(moneyAccountListV1Schema, 'finance.read')
  accounts(@Query() query: unknown) {
    return this.service.accounts(parse(accountFiltersV1Schema, query));
  }
  @Post('accounts')
  @RequirePermissions('finance.write')
  @body(createMoneyAccountV1Schema)
  @responses(moneyAccountV1Schema, 'finance.write', 201)
  createAccount(@Body() value: unknown) {
    return this.service.createAccount(parse(createMoneyAccountV1Schema, value));
  }
  @Patch('accounts/:id')
  @RequirePermissions('finance.write')
  @body(updateMoneyAccountV1Schema)
  @responses(moneyAccountV1Schema, 'finance.write')
  updateAccount(@Param('id') id: string, @Body() value: unknown) {
    return this.service.updateAccount(
      id,
      parse(updateMoneyAccountV1Schema, value),
    );
  }
  @Post('accounts/:id/archive')
  @HttpCode(200)
  @RequirePermissions('finance.write')
  @body(accountVersionV1Schema)
  @responses(moneyAccountV1Schema, 'finance.write')
  archive(@Param('id') id: string, @Body() value: unknown) {
    return this.service.setAccountActive(
      id,
      parse(accountVersionV1Schema, value).expectedVersion,
      false,
    );
  }
  @Post('accounts/:id/restore')
  @HttpCode(200)
  @RequirePermissions('finance.write')
  @body(accountVersionV1Schema)
  @responses(moneyAccountV1Schema, 'finance.write')
  restore(@Param('id') id: string, @Body() value: unknown) {
    return this.service.setAccountActive(
      id,
      parse(accountVersionV1Schema, value).expectedVersion,
      true,
    );
  }
  @Get('movements')
  @RequirePermissions('finance.read')
  @queries(financeMovementFiltersV1Schema)
  @responses(financeMovementListV1Schema, 'finance.read')
  movements(@Query() query: unknown) {
    return this.service.movements(parse(financeMovementFiltersV1Schema, query));
  }
  @Post('movements')
  @RequirePermissions('finance.write')
  @body(manualMovementInputV1Schema)
  @responses(financeMovementV1Schema, 'finance.write', 201)
  movement(@Body() value: unknown, @CurrentAuth() auth: AuthContext) {
    return this.service.createMovement(
      parse(manualMovementInputV1Schema, value),
      auth.subject,
    );
  }
  @Get('payments')
  @RequirePermissions('finance.read')
  @queries(paymentFiltersV1Schema)
  @responses(purchasePaymentListV1Schema, 'finance.read')
  payments(@Query() query: unknown) {
    return this.service.payments(parse(paymentFiltersV1Schema, query));
  }
  @Post('payments')
  @RequirePermissions('finance.write')
  @body(purchasePaymentInputV1Schema)
  @responses(purchasePaymentV1Schema, 'finance.write', 201)
  payment(@Body() value: unknown, @CurrentAuth() auth: AuthContext) {
    return this.service.createPayment(
      parse(purchasePaymentInputV1Schema, value),
      auth.subject,
    );
  }
  @Post('payments/:id/check')
  @HttpCode(200)
  @RequirePermissions('finance.write')
  @responses(purchasePaymentV1Schema, 'finance.write')
  check(@Param('id') id: string) {
    return this.service.checkPayment(id);
  }
  @Post('payments/:id/regularize')
  @HttpCode(200)
  @RequirePermissions('finance.write')
  @body(regularizePaymentV1Schema)
  @responses(purchasePaymentV1Schema, 'finance.write')
  regularize(
    @Param('id') id: string,
    @Body() value: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.service.regularizePayment(
      id,
      parse(regularizePaymentV1Schema, value).note,
      auth.subject,
    );
  }
  @Get('saleable-items')
  @RequirePermissions('finance.read')
  @queries(saleableItemFiltersV1Schema)
  @responses(saleableItemListV1Schema, 'finance.read')
  items(@Query() query: unknown) {
    const q = parse(saleableItemFiltersV1Schema, query);
    return this.service.saleableItems(q.search, q.page, q.pageSize);
  }
  @Get('sales')
  @RequirePermissions('finance.read')
  @queries(saleFiltersV1Schema)
  @responses(saleListV1Schema, 'finance.read')
  sales(@Query() query: unknown) {
    return this.service.sales(parse(saleFiltersV1Schema, query));
  }
  @Get('sales/:id')
  @RequirePermissions('finance.read')
  @responses(saleV1Schema, 'finance.read')
  sale(@Param('id') id: string) {
    return this.service.sale(id);
  }
  @Post('sales')
  @RequirePermissions('finance.write')
  @body(createSaleV1Schema)
  @responses(saleV1Schema, 'finance.write', 201)
  createSale(@Body() value: unknown, @CurrentAuth() auth: AuthContext) {
    return this.service.createSale(
      parse(createSaleV1Schema, value),
      auth.subject,
    );
  }
  @Post('sales/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('finance.write')
  @body(cancelSaleV1Schema)
  @responses(saleV1Schema, 'finance.write')
  cancelSale(
    @Param('id') id: string,
    @Body() value: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.service.cancelSale(
      id,
      parse(cancelSaleV1Schema, value),
      auth.subject,
    );
  }
  @Post('sales/:id/reconcile')
  @HttpCode(200)
  @RequirePermissions('finance.write')
  @responses(saleV1Schema, 'finance.write')
  reconcile(@Param('id') id: string) {
    return this.service.reconcile(id);
  }
}
