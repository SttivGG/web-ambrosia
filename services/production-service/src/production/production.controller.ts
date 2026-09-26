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
import {
  productionIdV1Schema,
  formulaInputV1Schema,
  formulaUpdateV1Schema,
  formulaV1Schema,
  formulaListV1Schema,
  formulaFiltersV1Schema,
  productionInputV1Schema,
  productionUpdateV1Schema,
  productionFiltersV1Schema,
  productionV1Schema,
  productionListV1Schema,
  productionCancelV1Schema,
  versionV1Schema,
  productionYieldInputV1Schema,
  packagingInputV1Schema,
} from '@ambrosia/contracts';
import { ProductionService } from './production.service';
import { parse } from './domain';
import { body, responses, queries } from './openapi';
@ApiTags('Producción v1')
@Controller({ path: 'production', version: '1' })
export class ProductionController {
  constructor(
    @Inject(ProductionService) private readonly service: ProductionService,
  ) {}
  @Get('formulas')
  @RequirePermissions('production.read')
  @queries(formulaFiltersV1Schema)
  @responses(formulaListV1Schema, 'production.read')
  formulas(@Query() q: unknown) {
    return this.service.formulas(parse(formulaFiltersV1Schema, q));
  }
  @Get('formulas/:id')
  @RequirePermissions('production.read')
  @responses(formulaV1Schema, 'production.read')
  formula(@Param('id') id: string) {
    return this.service.formula(parse(productionIdV1Schema, id));
  }
  @Post('formulas')
  @RequirePermissions('production.write')
  @body(formulaInputV1Schema)
  @responses(formulaV1Schema, 'production.write', 201)
  createFormula(@Body() input: unknown) {
    return this.service.saveFormula(parse(formulaInputV1Schema, input));
  }
  @Patch('formulas/:id')
  @RequirePermissions('production.write')
  @body(formulaUpdateV1Schema)
  @responses(formulaV1Schema, 'production.write')
  updateFormula(@Param('id') id: string, @Body() input: unknown) {
    const { expectedVersion, ...data } = parse(formulaUpdateV1Schema, input);
    return this.service.saveFormula(
      data,
      parse(productionIdV1Schema, id),
      expectedVersion,
    );
  }
  @Get('orders')
  @RequirePermissions('production.read')
  @queries(productionFiltersV1Schema)
  @responses(productionListV1Schema, 'production.read')
  list(@Query() q: unknown) {
    return this.service.list(parse(productionFiltersV1Schema, q));
  }
  @Get('orders/:id')
  @RequirePermissions('production.read')
  @responses(productionV1Schema, 'production.read')
  get(@Param('id') id: string) {
    return this.service.get(parse(productionIdV1Schema, id));
  }
  @Post('orders')
  @RequirePermissions('production.write')
  @body(productionInputV1Schema)
  @responses(productionV1Schema, 'production.write', 201)
  create(@Body() input: unknown, @CurrentAuth() auth: AuthContext) {
    return this.service.save(
      parse(productionInputV1Schema, input),
      auth.subject,
    );
  }
  @Patch('orders/:id')
  @RequirePermissions('production.write')
  @body(productionUpdateV1Schema)
  @responses(productionV1Schema, 'production.write')
  update(
    @Param('id') id: string,
    @Body() input: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const { expectedVersion, ...data } = parse(productionUpdateV1Schema, input);
    return this.service.save(
      data,
      auth.subject,
      parse(productionIdV1Schema, id),
      expectedVersion,
    );
  }
  @Post('orders/:id/start')
  @HttpCode(200)
  @RequirePermissions('production.write')
  @body(versionV1Schema)
  @responses(productionV1Schema, 'production.write')
  start(
    @Param('id') id: string,
    @Body() input: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.service.transition(
      parse(productionIdV1Schema, id),
      parse(versionV1Schema, input).expectedVersion,
      'start',
      auth.subject,
    );
  }
  @Post('orders/:id/complete')
  @HttpCode(200)
  @RequirePermissions('production.write')
  @body(versionV1Schema)
  @responses(productionV1Schema, 'production.write')
  complete(
    @Param('id') id: string,
    @Body() input: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.service.transition(
      parse(productionIdV1Schema, id),
      parse(versionV1Schema, input).expectedVersion,
      'complete',
      auth.subject,
    );
  }
  @Post('orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('production.write')
  @body(productionCancelV1Schema)
  @responses(productionV1Schema, 'production.write')
  cancel(
    @Param('id') id: string,
    @Body() input: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const data = parse(productionCancelV1Schema, input);
    return this.service.transition(
      parse(productionIdV1Schema, id),
      data.expectedVersion,
      'cancel',
      auth.subject,
      data.reason,
    );
  }
  @Post('orders/:id/reconcile')
  @HttpCode(200)
  @RequirePermissions('production.write')
  @body(versionV1Schema)
  @responses(productionV1Schema, 'production.write')
  reconcile(@Param('id') id: string, @Body() input: unknown) {
    parse(versionV1Schema, input);
    return this.service.reconcile(parse(productionIdV1Schema, id));
  }
  @Post('orders/:id/yield')
  @HttpCode(200)
  @RequirePermissions('production.write')
  @body(productionYieldInputV1Schema)
  @responses(productionV1Schema, 'production.write')
  recordYield(
    @Param('id') id: string,
    @Body() input: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.service.recordYield(
      parse(productionIdV1Schema, id),
      parse(productionYieldInputV1Schema, input),
      auth.subject,
    );
  }
  @Post('packaging')
  @HttpCode(200)
  @RequirePermissions('production.write')
  @body(packagingInputV1Schema)
  @responses(productionV1Schema, 'production.write')
  package(@Body() input: unknown, @CurrentAuth() auth: AuthContext) {
    return this.service.package(
      parse(packagingInputV1Schema, input),
      auth.subject,
    );
  }
}
