import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  Req,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiTags,
  ApiProperty,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CsrfService, COOKIE, readCookie } from './csrf.service';
import { LoginRateLimit } from './rate-limit.service';
import { KeysService } from './keys.service';
import { publicUser } from '../authorization/permissions';
import { normalizeEmail } from './password';
export class LoginDto {
  @ApiProperty({ example: 'nombre@empresa.example' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @ApiProperty({ format: 'password', minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
export class ChangePasswordDto {
  @ApiProperty({ format: 'password', maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
  @ApiProperty({ format: 'password', minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
class PublicUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] })
  role!: string;
  @ApiProperty({ type: [String] }) permissions!: string[];
}
class SuccessDto {
  @ApiProperty() ok!: boolean;
}
class CsrfDto {
  @ApiProperty() csrfToken!: string;
}
class ErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() message!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}
const jwksSchema: SchemaObject = {
  type: 'object',
  properties: {
    keys: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kid', 'kty', 'use', 'alg', 'n', 'e'],
        properties: {
          kid: { type: 'string' },
          kty: { type: 'string', enum: ['RSA'] },
          use: { type: 'string', enum: ['sig'] },
          alg: { type: 'string', enum: ['RS256'] },
          n: { type: 'string' },
          e: { type: 'string' },
        },
      },
    },
  },
};
@ApiTags('auth')
@ApiUnauthorizedResponse({
  type: ErrorDto,
  description: 'Credenciales o sesión no válidas. Respuesta genérica.',
})
@ApiForbiddenResponse({
  type: ErrorDto,
  description: 'CSRF u origen rechazado.',
})
@ApiBadRequestResponse({
  type: ErrorDto,
  description: 'DTO o política inválidos.',
})
@ApiTooManyRequestsResponse({
  type: ErrorDto,
  description: 'Límite por IP alcanzado.',
})
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly csrf: CsrfService,
    private readonly limiter: LoginRateLimit,
  ) {}
  private context(req: Request, res: Response) {
    return {
      correlationId: String(res.getHeader('X-Request-ID') ?? ''),
      userAgent: req.get('user-agent'),
    };
  }
  @Get('csrf')
  @ApiOkResponse({ type: CsrfDto })
  @ApiOperation({
    summary:
      'Emite cookie CSRF legible y binding HttpOnly; usar X-CSRF-Token y Origin en POST.',
  })
  csrfToken(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.csrf.issue(req, res);
  }
  @Post('login')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({
    type: PublicUserDto,
    description:
      'Cookies access/refresh HttpOnly y SameSite=Lax. Tokens nunca en el cuerpo.',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.csrf.validate(req);
    this.limiter.check(req.ip ?? 'unknown');
    const result = await this.auth.login(
      dto.email,
      dto.password,
      this.context(req, res),
    );
    this.csrf.setAuth(res, result.access, result.refresh, result.expiresAt);
    return result.user;
  }
  @Post('refresh')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCookieAuth('refresh')
  @ApiOkResponse({
    type: PublicUserDto,
    description: 'Rota cookies; reutilización revoca familia.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.csrf.validate(req);
    const result = await this.auth.refresh(
      readCookie(req, COOKIE.refresh),
      this.context(req, res),
    );
    this.csrf.setAuth(res, result.access, result.refresh, result.expiresAt);
    return result.user;
  }
  @Get('me')
  @ApiCookieAuth('access')
  @ApiOkResponse({ type: PublicUserDto })
  async me(@Req() req: Request) {
    return publicUser(
      (await this.auth.authenticate(readCookie(req, COOKIE.access))).user,
    );
  }
  @Post('logout')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({
    type: SuccessDto,
    description:
      'Idempotente; obtener CSRF nuevo si las cookies fueron eliminadas.',
  })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.csrf.validate(req);
    await this.auth.logout(
      readCookie(req, COOKIE.refresh),
      this.context(req, res),
    );
    this.csrf.clear(res);
    return { ok: true };
  }
  @Post('logout-all')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCookieAuth('access')
  @ApiOkResponse({ type: SuccessDto })
  async logoutAll(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.csrf.validate(req);
    await this.auth.logoutAll(
      readCookie(req, COOKIE.access),
      this.context(req, res),
    );
    this.csrf.clear(res);
    return { ok: true };
  }
  @Post('change-password')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCookieAuth('access')
  @ApiOkResponse({ type: SuccessDto })
  async change(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.csrf.validate(req);
    this.limiter.check(req.ip ?? 'unknown');
    await this.auth.changePassword(
      readCookie(req, COOKIE.access),
      dto.currentPassword,
      dto.newPassword,
      this.context(req, res),
    );
    this.csrf.clear(res);
    return { ok: true };
  }
}
@ApiTags('keys')
@Controller({ path: '.well-known', version: VERSION_NEUTRAL })
export class JwksController {
  constructor(private readonly keys: KeysService) {}
  @Get('jwks.json')
  @ApiOkResponse({ schema: jwksSchema })
  jwks() {
    return this.keys.jwks;
  }
}
