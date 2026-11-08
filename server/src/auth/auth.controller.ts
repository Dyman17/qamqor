import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginUserDto,
  PasswordResetRequestDto,
  PasswordResetConfirmDto,
  AcceptInvitationDto,
} from './dto/auth.dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from './current-user.decorator';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';

const MIN = 60_000;

@Controller('api/v1/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit('register', { limit: 10, windowMs: MIN, keyField: 'email' }, { limit: 30, windowMs: MIN })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(
    'login',
    { limit: 10, windowMs: MIN, keyField: 'email' },
    { limit: 30, windowMs: MIN },
    // per account across all IPs (single-instance memory limiter)
    { limit: 20, windowMs: 10 * MIN, keyField: 'email', perIp: false },
  )
  async login(@Body() dto: LoginUserDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user.id);
  }

  @Post('password-reset/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RateLimitGuard)
  @RateLimit('reset-request', { limit: 5, windowMs: MIN, keyField: 'email' }, { limit: 20, windowMs: MIN })
  requestReset(@Body() dto: PasswordResetRequestDto): void {
    this.authService.assertMailConfigured();
    // Deliberately not awaited: identical response and timing whether or not the email exists.
    this.authService.requestPasswordReset(dto).catch((e) => this.logger.error(`password reset request failed: ${e?.message}`));
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RateLimitGuard)
  @RateLimit('reset-confirm', { limit: 10, windowMs: MIN })
  async confirmReset(@Body() dto: PasswordResetConfirmDto): Promise<void> {
    await this.authService.confirmPasswordReset(dto);
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard, OptionalJwtAuthGuard)
  @RateLimit('invite-accept', { limit: 10, windowMs: MIN })
  async acceptInvitation(@Body() dto: AcceptInvitationDto, @CurrentUser() user: AuthenticatedUser | null) {
    return this.authService.acceptInvitation(dto, user ?? null);
  }
}
