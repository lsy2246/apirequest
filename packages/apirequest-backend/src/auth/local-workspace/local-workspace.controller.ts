import { Body } from '@nestjs/common';
import { AdoptLocalCollectionsDto } from './adopt-collections.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { LOCAL_WORKSPACE_UID } from './policy';
import {
  Controller,
  Post,
  Req,
  Res,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ThrottlerBehindProxyGuard } from 'src/guards/throttler-behind-proxy.guard';
import { authCookieHandler } from '../helper';
import { assertLocalWorkspaceRequest, getLocalWorkspaceConfig } from './policy';
import { LocalWorkspaceService } from './local-workspace.service';
import { relayLocalRequest } from './local-relay';

@Controller({ path: 'auth', version: '1' })
@UseGuards(ThrottlerBehindProxyGuard)
export class LocalWorkspaceController {
  constructor(
    private readonly config: ConfigService,
    private readonly workspace: LocalWorkspaceService,
  ) {}

  @Post('local-session')
  async connect(@Req() request: Request, @Res() response: Response) {
    const config = getLocalWorkspaceConfig(this.config);
    assertLocalWorkspaceRequest(request, config);
    // 只能由配置的工作台 AJAX 请求建立会话；普通跨站表单及无来源请求不得领取身份。
    if (
      request.headers['x-workbench-local'] !== '1' ||
      !request.is('application/json')
    )
      throw new ForbiddenException(
        'Local workspace request header is required',
      );
    response.setHeader('Cache-Control', 'no-store');
    const tokens = await this.workspace.establishSession(
      request.cookies?.access_token,
    );
    if (tokens) return authCookieHandler(response, tokens, this.config);
    return response.status(200).send();
  }
  @Post('local-collections')
  @UseGuards(JwtAuthGuard)
  async adopt(
    @Req() request: Request & { user: { uid: string } },
    @Body() body: AdoptLocalCollectionsDto,
  ) {
    const config = getLocalWorkspaceConfig(this.config);
    assertLocalWorkspaceRequest(request, config);
    if (
      request.user.uid !== LOCAL_WORKSPACE_UID ||
      request.headers['x-workbench-local'] !== '1'
    )
      throw new ForbiddenException();
    return this.workspace.adoptCollections(
      body.collectionsJSON,
      body.collectionType,
    );
  }

  @Post('local-relay')
  @UseGuards(JwtAuthGuard)
  async relay(
    @Req() request: Request & { user: { uid: string } },
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    const config = getLocalWorkspaceConfig(this.config);
    assertLocalWorkspaceRequest(request, config);
    if (
      request.user.uid !== LOCAL_WORKSPACE_UID ||
      request.headers['x-workbench-local'] !== '1' ||
      !request.is('application/json')
    )
      throw new ForbiddenException();

    response.setHeader('Cache-Control', 'no-store');
    response.status(200);
    return relayLocalRequest(
      body,
      response,
      request.headers.accept === 'application/x-workbench-relay',
    );
  }
}
