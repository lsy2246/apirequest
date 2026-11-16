import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as E from 'fp-ts/Either';
import { GqlUser } from 'src/decorators/gql-user.decorator';
import { RTCookie } from 'src/decorators/rt-cookie.decorator';
import { AuthUser } from 'src/types/AuthUser';
import { throwHTTPErr } from 'src/utils';
import { authCookieHandler } from './helper';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RTJwtAuthGuard } from './guards/rt-jwt-auth.guard';
import { AuthService } from './auth.service';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}
  @Get('refresh')
  @UseGuards(RTJwtAuthGuard)
  async refresh(
    @GqlUser() user: AuthUser,
    @RTCookie() token: string,
    @Res() response: Response,
  ) {
    const result = await this.authService.refreshAuthTokens(token, user);
    if (E.isLeft(result)) throwHTTPErr(result.left);
    return authCookieHandler(response, result.right, this.configService);
  }
  @Get('verify-token')
  @UseGuards(JwtAuthGuard)
  verifyToken(@GqlUser() user: AuthUser) {
    return { isValid: true, uid: user.uid };
  }
}
