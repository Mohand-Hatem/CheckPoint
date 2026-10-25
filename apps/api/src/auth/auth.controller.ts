import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AuthService } from './auth.service';
import { AllowPasswordChange } from './decorators/allow-password-change.decorator';
import { AuthenticatedUser, CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { RequirePermission } from './decorators/require-permission.decorator';
import {
  LoginResponseDto,
  LogoutResponseDto,
  PermissionCheckResponseDto,
  RefreshResponseDto,
  SessionDto,
} from './dto/auth-responses.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LoginThrottled } from './guards/login-throttle.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
      'More than 5 attempts per minute from one IP for one email returns 429.',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      admin: { summary: 'Development admin (from the seed)', value: { email: 'admin@checkpoint.local', password: 'AdminPassword123!' } },
    },
  })
  @ApiOkResponse({ type: LoginResponseDto, description: 'Signed in.' })
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
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.login(dto, userAgent);
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
      'The new access token always carries the account\'s own company; a refresh can never change company.',
  })
  @ApiOkResponse({ type: RefreshResponseDto, description: 'New access token and a new refresh token.' })
  @ApiValidationError()
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Unknown, expired or already-used refresh token, or the account was deactivated.',
    example: { statusCode: 401, message: 'Refresh token reuse detected. All sessions in this family revoked.', error: 'Unauthorized' },
  })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.refresh(dto, userAgent);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign out (revoke the whole session family)',
    description:
      'Public route (the refresh token is the credential).\n\n' +
      '**Scenario:** the user signs out. Every refresh token of that session is revoked, so refreshing fails afterwards. ' +
      'The current access token keeps working until it expires (up to 15 minutes). An unknown token still returns 200 so nothing is revealed.',
  })
  @ApiOkResponse({ type: LogoutResponseDto })
  @ApiValidationError()
  async logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }

  @Get('me')
  @AllowPasswordChange()
  @ApiProtected()
  @ApiOperation({
    summary: 'Who am I? (the claims of my access token)',
    description: '**Scenario:** check which user, company, role and permissions the current token carries. Works for any signed-in user.',
  })
  @ApiOkResponse({ type: SessionDto })
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return user;
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
