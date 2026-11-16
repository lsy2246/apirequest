import { MockTransportService } from './mock-transport';
import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MockServerService } from './mock-server.service';
import { MockServerAnalyticsService } from './mock-server-analytics.service';
import { MockServerLoggingInterceptor } from './mock-server-logging.interceptor';
import { MockServerResolver } from './mock-server.resolver';
import { MockServerController } from './mock-server.controller';
import { MockRuleController } from './mock-rule.controller';
import { MockRuleService } from './mock-rule.service';
import { AccessTokenModule } from 'src/access-token/access-token.module';
import { UserCollectionModule } from 'src/user-collection/user-collection.module';

@Module({
  // 供本机 MCP 适配层复用同一业务服务，避免复制权限与发布逻辑。
  exports: [MockServerService],
  imports: [PrismaModule, UserCollectionModule, AccessTokenModule],
  controllers: [MockServerController, MockRuleController],
  providers: [
    MockServerService,
    MockRuleService,
    MockTransportService,
    MockServerAnalyticsService,
    MockServerLoggingInterceptor,
    MockServerResolver,
  ],
})
export class MockServerModule {}
