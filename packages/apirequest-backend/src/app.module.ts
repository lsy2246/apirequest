import {
  assertLocalWorkspaceRequest,
  getLocalWorkspaceConfig,
} from './auth/local-workspace/policy';
import { WorkbenchMcpModule } from './workbench-mcp/mcp.module';
import { HttpException, Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { UserModule } from './user/user.module';
import { GQLComplexityPlugin } from './plugins/GQLComplexityPlugin';
import { AuthModule } from './auth/auth.module';
import { UserSettingsModule } from './user-settings/user-settings.module';
import { UserEnvironmentsModule } from './user-environment/user-environments.module';
import { UserRequestModule } from './user-request/user-request.module';
import { UserHistoryModule } from './user-history/user-history.module';
import { subscriptionContextCookieParser } from './auth/helper';
import { UserCollectionModule } from './user-collection/user-collection.module';
import { COOKIES_NOT_FOUND } from './errors';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InfraConfigModule } from './infra-config/infra-config.module';
import { loadInfraConfiguration } from './infra-config/helper';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { AccessTokenModule } from './access-token/access-token.module';
import { UserLastActiveOnInterceptor } from './interceptors/user-last-active-on.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { PubSubModule } from './pubsub/pubsub.module';
import { SortModule } from './orchestration/sort/sort.module';
import { MockServerModule } from './mock-server/mock-server.module';
import { PublishedDocsModule } from './published-docs/published-docs.module';

@Module({
  imports: [
    WorkbenchMcpModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [async () => loadInfraConfiguration()],
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        return {
          buildSchemaOptions: {
            numberScalarMode: 'integer',
          },
          playground: configService.get('PRODUCTION') !== 'true',
          autoSchemaFile: true,
          installSubscriptionHandlers: true,
          subscriptions: {
            'graphql-ws': {
              path: '/graphql',
              onConnect: (context: any) => {
                const request = context.extra.request;
                const local = getLocalWorkspaceConfig(configService);
                assertLocalWorkspaceRequest(request, local);
                const headers = { ...request.headers };
                const cookies: Record<string, unknown> = headers.cookie
                  ? subscriptionContextCookieParser(headers.cookie)
                  : {};
                if (context.connectionParams?.authorization) {
                  headers.authorization =
                    context.connectionParams.authorization;
                }
                if (!cookies.access_token && !headers.authorization)
                  throw new HttpException(COOKIES_NOT_FOUND, 401);
                context.extra.authRequest = { headers, cookies };
              },
            },
          },
          context: ({ req, res, extra }: any) => ({
            req: req ?? extra?.authRequest,
            res,
          }),
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => [
        {
          ttl: +configService.get('INFRA.RATE_LIMIT_TTL'),
          limit: +configService.get('INFRA.RATE_LIMIT_MAX'),
        },
      ],
    }),
    PrismaModule,
    PubSubModule,
    UserModule,
    AuthModule,
    UserSettingsModule,
    UserEnvironmentsModule,
    UserHistoryModule,
    UserRequestModule,
    UserCollectionModule,
    InfraConfigModule,
    ScheduleModule.forRoot(),
    HealthModule,
    AccessTokenModule,
    SortModule,
    MockServerModule,
    PublishedDocsModule,
  ],
  providers: [
    GQLComplexityPlugin,
    { provide: 'APP_INTERCEPTOR', useClass: UserLastActiveOnInterceptor },
  ],
  controllers: [AppController],
})
export class AppModule {}
