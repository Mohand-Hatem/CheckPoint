import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ACCESS_COOKIE, REFRESH_COOKIE, RequestWithSource, clearAuthCookies, csrfTokenFor, isCookieMode, readCookie, setAuthCookies } from './auth-transport';
import { AuthService } from './auth.service';
import { AllowPasswordChange } from './decorators/allow-password-change.decorator';
import { AuthenticatedUser, CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { RequirePermission } from './decorators/require-permission.decorator';
import {
  CookieLoginResponseDto,
  CookieRefreshResponseDto,
  LoginResponseDto,
  LogoutResponseDto,
  PermissionCheckResponseDto,
  RefreshResponseDto,
  SessionDto,
} from './dto/auth-responses.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LoginThrottled } from './guards/login-throttle.guard';

const COOKIE_MODE_HEADER = {
  name: 'X-Auth-Mode',
  required: false,
  enum: ['cookie'],
  description:
    'Web clients send `cookie`: the tokens are then set as HttpOnly cookies (`cp_access`, `cp_refresh`) and left out of the response body, which carries a `csrfToken` instead. Leave it out for the bearer flow (mobile, Apidog, curl).',
};

@ApiTags('Auth')
@ApiExtraModels(LoginResponseDto, CookieLoginResponseDto, RefreshResponseDto, CookieRefreshResponseDto)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private csrfFor(accessToken: string) {
    return csrfTokenFor(accessToken, this.config.getOrThrow<string>('JWT_ACCESS_SECRET'));
  }

  private refreshDays() {
    return parseInt(this.config.get<string>('REFRESH_TOKEN_EXPIRES_DAYS', '30'), 10);
  }

  @Public()
  @LoginThrottled()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      '**Start here.** Public route.\n\n' +
      '**Scenario:** an ADMIN or EMPLOYEE signs in. The response holds a 15-minute `accessToken` (a JWT carrying `companyId`, `role` and `permissions`) ' +
      'and a 30-day single-use `refreshToken`. Send the access token as `Authorization: Bearer <accessToken>` on every other call.\n\n' +
      '**Rules:** the same message is returned for an unknown email and a wrong password. A deactivated account is refused. ' +
      'More than 5 attempts per minute from one IP for one email returns 429.\n\n' +
      '**Web (cookie mode):** send the header `X-Auth-Mode: cookie`. The response then sets `cp_access` and `cp_refresh` as HttpOnly, SameSite=Lax cookies and returns `{ user, csrfToken }` with no tokens in the body.',
  })
  @ApiHeader(COOKIE_MODE_HEADER)
  @ApiBody({
    type: LoginDto,
    examples: {
      admin: { summary: 'Development admin (from the seed)', value: { email: 'admin@checkpoint.local', password: 'AdminPassword123!' } },
    },
  })
  @ApiOkResponse({
    description: 'Signed in. Bearer flow: tokens in the body. Cookie mode: cookies are set and the body holds `user` and `csrfToken`.',
    schema: { oneOf: [{ $ref: getSchemaPath(LoginResponseDto) }, { $ref: getSchemaPath(CookieLoginResponseDto) }] },
  })
  @ApiValidationError()
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Wrong email or password, or the account is deactivated.',
    example: { statusCode: 401, message: 'Invalid email or password', error: 'Unauthorized' },
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: 'More than 5 login attempts in one minute for this IP and email.',
    example: { statusCode: 429, message: 'Too many login attempts. Please try again in 42 seconds.' },
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    const result = await this.authService.login(dto, userAgent);
    if (!isCookieMode(req)) return result;

    setAuthCookies(res, result, this.refreshDays());
    return { user: result.user, csrfToken: this.csrfFor(result.accessToken) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description:
      'Public route (the refresh token is the credential).\n\n' +
      '**Scenario:** the access token expired (401). Send the refresh token, store BOTH new tokens, and discard the old refresh token: it is single-use.\n\n' +
      '**Theft detection:** if an already-used refresh token is presented again, the whole session family is revoked and this returns 401. ' +
      'The new access token always carries the account\'s own company; a refresh can never change company.\n\n' +
      '**Web (cookie mode):** send `X-Auth-Mode: cookie` and no body. The refresh token is read from the `cp_refresh` cookie, both cookies are replaced, and the body holds the new `csrfToken`.',
  })
  @ApiHeader(COOKIE_MODE_HEADER)
  @ApiOkResponse({
    description: 'New token pair (bearer flow) or new cookies plus a new `csrfToken` (cookie mode).',
    schema: { oneOf: [{ $ref: getSchemaPath(RefreshResponseDto) }, { $ref: getSchemaPath(CookieRefreshResponseDto) }] },
  })
  @ApiValidationError()
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Unknown, expired or already-used refresh token, or the account was deactivated.',
    example: { statusCode: 401, message: 'Refresh token reuse detected. All sessions in this family revoked.', error: 'Unauthorized' },
  })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    const cookieMode = isCookieMode(req);
    const refreshToken = cookieMode ? readCookie(req, REFRESH_COOKIE) : dto.refreshToken;
    if (!refreshToken) throw new BadRequestException(['Refresh token is required']);

    try {
      const tokens = await this.authService.refresh({ refreshToken }, userAgent);
      if (!cookieMode) return tokens;

      setAuthCookies(res, tokens, this.refreshDays());
      return { csrfToken: this.csrfFor(tokens.accessToken) };
    } catch (error) {
      // A spent or unknown cookie is useless: remove it so the web app goes back to the sign-in page.
      if (cookieMode && error instanceof UnauthorizedException) clearAuthCookies(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign out (revoke the whole session family)',
    description:
      'Public route (the refresh token is the credential).\n\n' +
      '**Scenario:** the user signs out. Every refresh token of that session is revoked, so refreshing fails afterwards. ' +
      'The current access token keeps working until it expires (up to 15 minutes). An unknown token still returns 200 so nothing is revealed.\n\n' +
      '**Web (cookie mode):** send `X-Auth-Mode: cookie` and no body; the refresh token comes from the cookie and both cookies are cleared.',
  })
  @ApiHeader(COOKIE_MODE_HEADER)
  @ApiOkResponse({ type: LogoutResponseDto })
  @ApiValidationError()
  async logout(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!isCookieMode(req)) {
      if (!dto.refreshToken) throw new BadRequestException(['Refresh token is required']);
      return this.authService.logout({ refreshToken: dto.refreshToken });
    }

    const refreshToken = readCookie(req, REFRESH_COOKIE);
    clearAuthCookies(res);
    return refreshToken ? this.authService.logout({ refreshToken }) : { success: true, message: 'Logged out successfully' };
  }

  @Get('me')
  @AllowPasswordChange()
  @ApiProtected()
  @ApiOperation({
    summary: 'Who am I? (the claims of my access token)',
    description:
      '**Scenario:** check which user, company, role and permissions the current token carries. Works for any signed-in user.\n\n' +
      'When the request was authenticated by the access **cookie**, the response also holds the current `csrfToken`, so a web page can recover it after a reload.',
  })
  @ApiOkResponse({ type: SessionDto })
  async getProfile(@CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithSource) {
    if (req.authSource !== 'cookie') return user;
    return { ...user, csrfToken: this.csrfFor(readCookie(req, ACCESS_COOKIE) ?? '') };
  }

  @Get('test-permission')
  @RequirePermission('users.read')
  @ApiProtected()
  @ApiNeedsPermission('users.read')
  @ApiOperation({
    summary: 'Diagnostic: succeeds only if the token has users.read',
    description:
      '**Scenario:** a quick way to see authorization working. An ADMIN gets 200; an EMPLOYEE signed in with a valid token gets 403; no token gets 401.',
  })
  @ApiOkResponse({ type: PermissionCheckResponseDto })
  async testPermission(@CurrentUser() user: AuthenticatedUser) {
    return {
      message: 'Access granted: you have users.read permission',
      user,
    };
  }
}
