import 'dotenv/config';
import { json, urlencoded, type Request } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // Default body-parser limit is 100kb, which a few hundred imported rows'
  // worth of JSON (the recordImportHistory payload) can exceed -- that
  // request was failing silently on large imports (see Import.tsx's
  // swallowed .catch on recordHistory), leaving no audit log entry for the
  // import even though the calls themselves were saved fine.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Render (and most PaaS hosts) put this app behind a reverse proxy --
  // without trust proxy, req.ip is the proxy's own internal address for
  // every request, not the real visitor. This makes Express read the
  // client's real IP from X-Forwarded-For instead (used for login-device
  // geolocation; see LoginTrackingService).
  app.set('trust proxy', 1);
  // Captures the raw request body alongside express's usual JSON parsing --
  // needed to verify Meta's X-Hub-Signature-256 header on the WhatsApp
  // webhook, which is an HMAC over the exact raw bytes Meta sent (the
  // already-parsed/re-serialized body won't byte-for-byte match).
  app.use(json({ limit: '15mb', verify: (req: Request & { rawBody?: Buffer }, _res, buf) => { req.rawBody = buf; } }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));

  // Comma-separated list of dashboard origins allowed to call this API. Defaults
  // to the local Vite dev server; add the deployed dashboard's URL in production
  // via ALLOWED_ORIGINS, e.g. "https://app.customheadlights.com,http://localhost:5173".
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
