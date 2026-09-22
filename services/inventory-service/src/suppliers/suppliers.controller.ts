import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Inject,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBody } from '@nestjs/swagger';
import { RequirePermissions } from '@ambrosia/nest-auth';
import {
  createSupplierV1Schema,
  updateSupplierV1Schema,
  supplierFiltersV1Schema,
  versionV1Schema,
} from '@ambrosia/contracts';
import { SuppliersService } from './suppliers.service';
import { SupplierError } from './domain';
import { supplierBody, supplierQueries, supplierResponses } from './openapi';
import { versionBody } from '../catalog/openapi';
type Schema<T> = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[] }[] } };
};
function parse<T>(schema: Schema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new SupplierError(
      'VALIDATION_ERROR',
      400,
      'Revisa los campos indicados, sus formatos y longitudes.',
      result.error.issues.map((i) => i.path.join('.')),
    );
  return result.data;
}
@ApiTags('Proveedores v1')
@Controller({ path: 'suppliers', version: '1' })
export class SuppliersController {
  constructor(
    @Inject(SuppliersService) private readonly service: SuppliersService,
  ) {}
  @Get()
  @RequirePermissions('inventory.read')
  @supplierQueries()
  @supplierResponses(true)
  list(@Query() query: unknown) {
    return this.service.list(parse(supplierFiltersV1Schema, query));
  }
  @Get(':id')
  @RequirePermissions('inventory.read')
  @supplierResponses()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
  @Post()
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: supplierBody(false) })
  @supplierResponses(false, 201)
  create(@Body() body: unknown) {
    return this.service.create(parse(createSupplierV1Schema, body));
  }
  @Patch(':id')
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: supplierBody(true) })
  @supplierResponses()
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.update(id, parse(updateSupplierV1Schema, body));
  }
  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: versionBody })
  @supplierResponses()
  archive(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.state(
      id,
      parse(versionV1Schema, body).expectedVersion,
      false,
    );
  }
  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: versionBody })
  @supplierResponses()
  restore(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.state(
      id,
      parse(versionV1Schema, body).expectedVersion,
      true,
    );
  }
}
