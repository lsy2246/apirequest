import { CapacityService } from './capacity/capacity.service';
import {
  assertLocalWorkspaceRequest,
  getLocalWorkspaceConfig,
} from './auth/local-workspace/policy';
import { NestFactory } from '@nestjs/core';
import { json, raw, type Request, type RequestHandler } from 'express';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { emitGQLSchemaFile } from './gql-schema';
import morgan from 'morgan';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import compression from 'compression';

// The bare /mock route (with an optional trailing slash) opens the management UI.
function isMockEndpoint(path: string): boolean {
  return path.startsWith('/mock/') && path !== '/mock/';
}

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
  const tlsCert = process.env.APIREQUEST_TLS_CERT;
  const tlsKey = process.env.APIREQUEST_TLS_KEY;
  if (!!tlsCert !== !!tlsKey)
    throw new Error(
      'Configure both APIREQUEST_TLS_CERT and APIREQUEST_TLS_KEY',
    );
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...(tlsCert && tlsKey
      ? {
          httpsOptions: {
            cert: readFileSync(tlsCert),
            key: readFileSync(tlsKey),
          },
        }
      : {}),
  });

  const configService = app.get(ConfigService);
  const isProduction = configService.get('PRODUCTION') === 'true';

  console.log(`Running in production: ${isProduction}`);
  console.log(`Port: ${configService.get('PORT')}`);

  warnIfExampleSecrets(configService);

  const localWorkspace = getLocalWorkspaceConfig(configService);
  // 固定单人工作区，所有会话和写操作使用同一份来源边界。
  app.use((req, res, next) => {
    try {
      const publicEndpoint =
        isMockEndpoint(req.path) ||
        req.path.startsWith('/v1/published-docs/');
      const needsOrigin =
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
        req.path.startsWith('/v1/auth/');
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
  app.enableCors({
    origin: localWorkspace.origins,
    credentials: true,
    exposedHeaders: ['Retry-After', 'X-Workbench-Detail-Batch-Size'],
  });
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

  const capacity = app.get(CapacityService);
  const parseJson: RequestHandler = (
    req: Request & { rawBody?: Buffer; workbenchImportBytes?: number },
    res,
    next,
  ) => {
    const workspaceImport =
      /^\/v1\/workbench-mcp\/data\/workspace\/import\/?$/i.test(req.path);
    json({
      limit: capacity.jsonBodyLimit(req.path),
      verify: (_request, _response, body) => {
        if (req.path.startsWith('/mock/'))
          req.rawBody = Buffer.from(body);
        if (workspaceImport) req.workbenchImportBytes = body.length;
      },
    })(req, res, next);
  };
  app.use(parseJson);

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
  app.use(compression({
    level: 4,
    filter: (req, res) =>
      !isMockEndpoint(req.path) &&
      !String(res.getHeader('Content-Type') ?? '').includes('text/event-stream') &&
      compression.filter(req, res),
  }));

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

  // Optional single-origin web deployment, sharing the API's network boundary.
  const webRoot = configService.get<string>('APIREQUEST_WEB_ROOT');
  if (webRoot) {
    const root = resolve(webRoot);
    app.useStaticAssets(root, {
      setHeaders: (res, file) => {
        res.setHeader('Cache-Control', file.startsWith(resolve(root, 'assets') + '/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache');
      },
    });
    app.use((req, res, next) => {
      const apiPath = isMockEndpoint(req.path) || /^\/(v1|graphql|health)(\/|$)/.test(req.path);
      if (req.method === 'GET' && !apiPath && req.accepts('html'))
        return res.sendFile(resolve(root, 'index.html'));
      next();
    });
  }

  app.use(morgan(':remote-addr :method :url :status - :response-time ms'));

  await app.listen(configService.get('PORT') || 3170, localWorkspace.bindHost);

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
