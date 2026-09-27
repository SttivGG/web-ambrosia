import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@ambrosia/nest-auth';
import {
  reportFinanceFiltersV1Schema,
  reportInventoryFiltersV1Schema,
  reportMovementFiltersV1Schema,
  reportProductionFiltersV1Schema,
} from '@ambrosia/contracts';
import { parse } from '../finance/domain';
import { queries } from '../finance/openapi';
import { InventoryReconciliationService } from './reconciliation.service';
import { ReportingService } from './reporting.service';

@ApiTags('Reportes v1')
@Controller({ path: 'reports', version: '1' })
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly reconciliation: InventoryReconciliationService,
  ) {}

  @Get('health')
  @RequirePermissions('reports.read')
  @ApiOperation({
    description:
      'Permiso: reports.read. Estado y conteos de las proyecciones derivadas.',
  })
  health() {
    return this.reporting.health();
  }

  @Get('inventory')
  @RequirePermissions('reports.read')
  @queries(reportInventoryFiltersV1Schema)
  inventory(@Query() query: unknown) {
    return this.reporting.inventory(
      parse(reportInventoryFiltersV1Schema, query),
    );
  }

  @Get('inventory/movements')
  @RequirePermissions('reports.read')
  @queries(reportMovementFiltersV1Schema)
  movements(@Query() query: unknown) {
    return this.reporting.movements(
      parse(reportMovementFiltersV1Schema, query),
    );
  }

  @Get('production')
  @RequirePermissions('reports.read')
  @queries(reportProductionFiltersV1Schema)
  production(@Query() query: unknown) {
    return this.reporting.production(
      parse(reportProductionFiltersV1Schema, query),
    );
  }

  @Get('finance')
  @RequirePermissions('reports.read', 'reports.finance')
  @queries(reportFinanceFiltersV1Schema)
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
