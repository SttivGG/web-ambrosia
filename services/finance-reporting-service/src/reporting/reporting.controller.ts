import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentAuth,
  RequirePermissions,
  type AuthContext,
} from '@ambrosia/nest-auth';
import {
  reportFinanceFiltersV1Schema,
  reportFinanceListV1Schema,
  reportHealthV1Schema,
  reportInventoryFiltersV1Schema,
  reportInventoryListV1Schema,
  reportMovementFiltersV1Schema,
  reportMovementListV1Schema,
  reportPackagingFiltersV1Schema,
  reportPackagingListV1Schema,
  reportProductionFiltersV1Schema,
  reportProductionListV1Schema,
  reportPurchaseFiltersV1Schema,
  reportPurchaseListV1Schema,
  reportSummaryV1Schema,
  reportSupplierFiltersV1Schema,
  reportSupplierListV1Schema,
  reportSupplierV1Schema,
} from '@ambrosia/contracts';
import { parse } from '../finance/domain';
import { queries, responses } from '../finance/openapi';
import { InventoryReconciliationService } from './reconciliation.service';
import { ReportingService } from './reporting.service';
import { OperationalReportsService } from './operational.service';
import { ProductionReconciliationService } from './production-reconciliation.service';

@ApiTags('Reportes v1')
@Controller({ path: 'reports', version: '1' })
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly operational: OperationalReportsService,
    private readonly reconciliation: InventoryReconciliationService,
    private readonly productionReconciliation: ProductionReconciliationService,
  ) {}

  @Get('health')
  @RequirePermissions('reports.read')
  @responses(reportHealthV1Schema, 'reports.read')
  health() {
    return this.reporting.health();
  }

  @Get('inventory')
  @RequirePermissions('reports.read')
  @queries(reportInventoryFiltersV1Schema)
  @responses(reportInventoryListV1Schema, 'reports.read')
  inventory(@Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.reporting.inventory(
      parse(reportInventoryFiltersV1Schema, query),
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('inventory/summary')
  @RequirePermissions('reports.read')
  @queries(reportInventoryFiltersV1Schema)
  @responses(reportSummaryV1Schema, 'reports.read')
  inventorySummary(@Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.reporting.inventorySummary(
      parse(reportInventoryFiltersV1Schema, query),
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('inventory/movements')
  @RequirePermissions('reports.read')
  @queries(reportMovementFiltersV1Schema)
  @responses(reportMovementListV1Schema, 'reports.read')
  movements(@Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.reporting.movements(
      parse(reportMovementFiltersV1Schema, query),
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('production')
  @RequirePermissions('reports.read')
  @queries(reportProductionFiltersV1Schema)
  @responses(reportProductionListV1Schema, 'reports.read')
  production(@Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.operational.production(
      parse(reportProductionFiltersV1Schema, query),
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('production/summary')
  @RequirePermissions('reports.read')
  @queries(reportProductionFiltersV1Schema)
  @responses(reportSummaryV1Schema, 'reports.read')
  productionSummary(@Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.operational.productionSummary(
      parse(reportProductionFiltersV1Schema, query),
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('purchases')
  @RequirePermissions('reports.read')
  @queries(reportPurchaseFiltersV1Schema)
  @responses(reportPurchaseListV1Schema, 'reports.read')
  purchases(@Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.operational.purchases(
      parse(reportPurchaseFiltersV1Schema, query),
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('purchases/summary')
  @RequirePermissions('reports.read')
  @queries(reportPurchaseFiltersV1Schema)
  @responses(reportSummaryV1Schema, 'reports.read')
  purchaseSummary(@Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.operational.purchaseSummary(
      parse(reportPurchaseFiltersV1Schema, query),
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('suppliers')
  @RequirePermissions('reports.read')
  @queries(reportSupplierFiltersV1Schema)
  @responses(reportSupplierListV1Schema, 'reports.read')
  suppliers(@Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.operational.suppliers(
      parse(reportSupplierFiltersV1Schema, query),
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('suppliers/:id')
  @RequirePermissions('reports.read')
  @responses(reportSupplierV1Schema, 'reports.read')
  supplier(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.operational.supplier(
      id,
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('yield')
  @RequirePermissions('reports.read')
  @queries(reportProductionFiltersV1Schema)
  @responses(reportProductionListV1Schema, 'reports.read')
  yieldReport(@Query() query: unknown) {
    return this.operational.production(
      parse(reportProductionFiltersV1Schema, query),
      false,
    );
  }

  @Get('yield/summary')
  @RequirePermissions('reports.read')
  @queries(reportProductionFiltersV1Schema)
  @responses(reportSummaryV1Schema, 'reports.read')
  yieldSummary(@Query() query: unknown) {
    return this.operational.yieldSummary(
      parse(reportProductionFiltersV1Schema, query),
    );
  }

  @Get('waste')
  @RequirePermissions('reports.read')
  @queries(reportProductionFiltersV1Schema)
  @responses(reportProductionListV1Schema, 'reports.read')
  waste(@Query() query: unknown) {
    return this.operational.production(
      parse(reportProductionFiltersV1Schema, query),
      false,
    );
  }

  @Get('waste/summary')
  @RequirePermissions('reports.read')
  @queries(reportProductionFiltersV1Schema)
  @responses(reportSummaryV1Schema, 'reports.read')
  wasteSummary(@Query() query: unknown) {
    return this.operational.wasteSummary(
      parse(reportProductionFiltersV1Schema, query),
    );
  }

  @Get('packaging')
  @RequirePermissions('reports.read')
  @queries(reportPackagingFiltersV1Schema)
  @responses(reportPackagingListV1Schema, 'reports.read')
  packaging(@Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.operational.packaging(
      parse(reportPackagingFiltersV1Schema, query),
      auth.permissions.includes('reports.finance'),
    );
  }

  @Get('finance')
  @RequirePermissions('reports.read', 'reports.finance')
  @queries(reportFinanceFiltersV1Schema)
  @responses(reportFinanceListV1Schema, 'reports.read + reports.finance')
  finance(@Query() query: unknown) {
    return this.reporting.finance(parse(reportFinanceFiltersV1Schema, query));
  }

  @Post('admin/inventory/reconcile')
  @HttpCode(200)
  @RequirePermissions('reports.manage')
  @ApiOperation({
    description:
      'Permiso: reports.manage. Reaplica snapshots autoritativos de Inventory de forma idempotente.',
  })
  reconcile() {
    return this.reconciliation.reconcile();
  }

  @Post('admin/production/reconcile')
  @HttpCode(200)
  @RequirePermissions('reports.manage')
  reconcileProduction() {
    return this.productionReconciliation.reconcile();
  }

  @Post('admin/production/rebuild')
  @HttpCode(200)
  @RequirePermissions('reports.manage')
  rebuildProduction() {
    return this.productionReconciliation.rebuild();
  }

  @Post('admin/reconcile')
  @HttpCode(200)
  @RequirePermissions('reports.manage')
  async reconcileAll() {
    return {
      inventory: await this.reconciliation.reconcile(),
      production: await this.productionReconciliation.reconcile(),
    };
  }

  @Post('admin/rebuild')
  @HttpCode(200)
  @RequirePermissions('reports.manage')
  async rebuildAll() {
    return {
      inventory: await this.reconciliation.rebuild(),
      production: await this.productionReconciliation.rebuild(),
    };
  }

  @Post('admin/inventory/rebuild')
  @HttpCode(200)
  @RequirePermissions('reports.manage')
  @ApiOperation({
    description:
      'Permiso: reports.manage. Elimina solo la proyección derivada de Inventory y la reconstruye desde su API interna.',
  })
  rebuild() {
    return this.reconciliation.rebuild();
  }
}
