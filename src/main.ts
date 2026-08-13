import 'dotenv/config';
import { json, urlencoded } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Default body-parser limit is 100kb, which a few hundred imported rows'
  // worth of JSON (the recordImportHistory payload) can exceed -- that
  // request was failing silently on large imports (see Import.tsx's
  // swallowed .catch on recordHistory), leaving no audit log entry for the
  // import even though the calls themselves were saved fine.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '15mb' }));
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
