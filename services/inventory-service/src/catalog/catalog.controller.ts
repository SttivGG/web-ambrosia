import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Req,
  Inject,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { RequirePermissions, type AuthRequest } from '@ambrosia/nest-auth';
import {
  createCategoryV1Schema,
  updateCategoryV1Schema,
  createItemV1Schema,
  updateItemV1Schema,
  versionV1Schema,
  categoryFiltersV1Schema,
  itemFiltersV1Schema,
} from '@ambrosia/contracts';
import { CatalogService } from './catalog.service';
import { CatalogError } from './domain';
import {
  categoryBody,
  itemBody,
  versionBody,
  listQueries,
  catalogResponses,
} from './openapi';
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
    throw new CatalogError(
      'VALIDATION_ERROR',
      400,
      'Revisa los campos indicados, sus formatos y longitudes.',
      result.error.issues.map((i) => i.path.join('.')),
    );
  return result.data;
}
const context = (req: AuthRequest) => ({
  subject: req.auth!.subject,
  correlationId: String(req.res?.getHeader('X-Request-ID') ?? ''),
});
@ApiTags('Catálogo v1')
@Controller({ path: 'catalog', version: '1' })
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly service: CatalogService,
  ) {}
  @Get('categories')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Consultar categorías (inventory.read)' })
  @listQueries(false)
  @catalogResponses('categoryList')
  categories(@Query() query: unknown) {
    return this.service.listCategories(parse(categoryFiltersV1Schema, query));
  }
  @Get('categories/:id')
  @RequirePermissions('inventory.read')
  @catalogResponses('category')
  category(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getCategory(id);
  }
  @Post('categories')
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: categoryBody(false) })
  @catalogResponses('category', 201)
  createCategory(@Body() body: unknown, @Req() req: AuthRequest) {
    return this.service.createCategory(
      parse(createCategoryV1Schema, body),
      context(req),
    );
  }
  @Patch('categories/:id')
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: categoryBody(true) })
  @catalogResponses('category')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.updateCategory(
      id,
      parse(updateCategoryV1Schema, body),
      context(req),
    );
  }
  @Post('categories/:id/archive')
  @HttpCode(200)
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: versionBody })
  @catalogResponses('category')
  archiveCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.categoryState(
      id,
      parse(versionV1Schema, body).expectedVersion,
      false,
      context(req),
    );
  }
  @Post('categories/:id/restore')
  @HttpCode(200)
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: versionBody })
  @catalogResponses('category')
  restoreCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.categoryState(
      id,
      parse(versionV1Schema, body).expectedVersion,
      true,
      context(req),
    );
  }
  @Get('items')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Consultar artículos (inventory.read)' })
  @listQueries(true)
  @catalogResponses('itemList')
  items(@Query() query: unknown) {
    return this.service.listItems(parse(itemFiltersV1Schema, query));
  }
  @Get('items/:id')
  @RequirePermissions('inventory.read')
  @catalogResponses('item')
  item(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getItem(id);
  }
  @Post('items')
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: itemBody(false) })
  @catalogResponses('item', 201)
  createItem(@Body() body: unknown, @Req() req: AuthRequest) {
    return this.service.createItem(
      parse(createItemV1Schema, body),
      context(req),
    );
  }
  @Patch('items/:id')
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: itemBody(true) })
  @catalogResponses('item')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.updateItem(
      id,
      parse(updateItemV1Schema, body),
      context(req),
    );
  }
  @Post('items/:id/archive')
  @HttpCode(200)
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: versionBody })
  @catalogResponses('item')
  archiveItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.itemState(
      id,
      parse(versionV1Schema, body).expectedVersion,
      false,
      context(req),
    );
  }
  @Post('items/:id/restore')
  @HttpCode(200)
  @RequirePermissions('inventory.write')
  @ApiBody({ schema: versionBody })
  @catalogResponses('item')
  restoreItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.itemState(
      id,
      parse(versionV1Schema, body).expectedVersion,
      true,
      context(req),
    );
  }
}
