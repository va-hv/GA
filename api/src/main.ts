import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AccessGuard, GuessLimit } from './access';
import { Db } from './db';
import { GateController } from './gate.controller';
import { AuthController, HealthController, KioskController, SiteController, TeamController } from './people.controller';
import { ProblemFilter } from './problems';

@Module({
  controllers: [HealthController, AuthController, SiteController, TeamController, KioskController, GateController],
  providers: [
    Db,
    GuessLimit,
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
class AppModule {}

async function start() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '5mb' }); // a kiosk photo is up to ~3 MB
  app.set('trust proxy', 'loopback, uniquelocal'); // the web app (and the reverse proxy) sit in front
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3601), '0.0.0.0');

  // Retention: each site's expired photos and personal details are removed hourly (and once at start).
  const db = app.get(Db);
  const log = new Logger('Retention');
  const sweep = () => db.as(null, (sql) => sql<{ site: string; photos: number; erased: number }>('SELECT * FROM gate.apply_retention()'))
    .then((rows) => rows.forEach((r) => log.log(`site ${r.site}: ${r.photos} photos and ${r.erased} visits' personal details removed`)))
    .catch((e) => log.error(`retention failed: ${e instanceof Error ? e.message : e}`));
  void sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}

start();
