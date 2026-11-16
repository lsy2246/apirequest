import {
  assertLocalWorkspaceRequest,
  getLocalWorkspaceConfig,
} from './auth/local-workspace/policy';
import { NestFactory } from '@nestjs/core';
import { json, raw } from 'express';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { emitGQLSchemaFile } from './gql-schema';
import morgan from 'morgan';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';

function warnIfExampleSecrets(configService: ConfigService): void {
  if (
    configService.get('DATA_ENCRYPTION_KEY') ===
    'data encryption key with 32 char'
  ) {
    console.warn(
      '[SECURITY] DATA_ENCRYPTION_KEY is set to the example value from .env.example. Please change it.',
    );
  }

  try {
    const dbUrl = new URL(configService.get('DATABASE_URL') ?? '');
    if (decodeURIComponent(dbUrl.password) === 'testpass') {
      console.warn(
        '[SECURITY] DATABASE_URL uses the example database password. Please change it.',
      );
    }
  } catch {
    // Invalid or missing DATABASE_URL, nothing to check
  }
}

export async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const isProduction = configService.get('PRODUCTION') === 'true';

  console.log(`Running in production: ${isProduction}`);
  console.log(`Port: ${configService.get('PORT')}`);

  warnIfExampleSecrets(configService);

  app.use(
    '/mock',
    json({
      limit: '20mb',
      strict: false,
      verify: (req, _res, body) => {
        (req as any).rawBody = Buffer.from(body);
      },
    }),
  );

  // Increase file upload limit to 100MB
  app.use(
    json({
      limit: '100mb',
      verify: (req, _res, body) => {
        if (req.url?.startsWith('/mock/'))
          (req as any).rawBody = Buffer.from(body);
      },
    }),
  );

  app.use(
    '/mock',
    raw({
      type: () => true,
      limit: '20mb',
      verify: (req, _res, body) => {
        (req as any).rawBody = Buffer.from(body);
      },
    }),
  );

  const localWorkspace = getLocalWorkspaceConfig(configService);
  if (localWorkspace) {
    // 本机无交互模式保留所有业务鉴权，仅限制可领取会话及发起写操作的来源。
    app.use((req, res, next) => {
      try {
        const publicEndpoint =
          req.path.startsWith('/mock/') ||
          req.path.startsWith('/v1/published-docs/');
        const needsOrigin =
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
          (req.path.startsWith('/v1/auth/') &&
            req.path !== '/v1/auth/session-mode');
        assertLocalWorkspaceRequest(
          req,
          localWorkspace,
          needsOrigin,
          publicEndpoint,
        );
        next();
      } catch {
        res
          .status(403)
          .json({ message: 'Local workspace request is not allowed' });
      }
    });
    app.enableCors({ origin: localWorkspace.origins, credentials: true });
  } else if (isProduction) {
    console.log('Enabling CORS with production settings');
    app.enableCors({
      origin: configService.get('WHITELISTED_ORIGINS').split(','),
      credentials: true,
    });
  } else {
    console.log('Enabling CORS with development settings');
    app.enableCors({
      origin: true,
      credentials: true,
    });
  }

  app.enableVersioning({
    type: VersioningType.URI,
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (configService.get('TRUST_PROXY') === 'true') {
    console.log('Enabling trust proxy');
    app.set('trust proxy', true);
  }

  app.use(morgan(':remote-addr :method :url :status - :response-time ms'));

  await app.listen(
    configService.get('PORT') || 3170,
    localWorkspace ? '127.0.0.1' : '0.0.0.0',
  );

  return app;
}

async function startServer() {
  const app = await bootstrap();
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.info('SIGTERM signal received, initiating graceful shutdown...');
    await app.close();
    console.info('Application closed successfully');
    process.exit(0);
  });
}

// 桌面子进程需要等待启动完成，并由应用退出流程负责关闭服务。
if (require.main === module) {
  if (process.env.GENERATE_GQL_SCHEMA) emitGQLSchemaFile();
  else void startServer();
}
