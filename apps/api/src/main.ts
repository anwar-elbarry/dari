import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { RedactingLogger } from './common/redacting-logger';
import { parseEnv } from './config/env';

async function bootstrap() {
  const config = parseEnv(process.env);
  const app = await NestFactory.create(AppModule.register(config), { logger: new RedactingLogger() });
  configureApp(app, config);
  await app.listen(config.PORT);
}
bootstrap().catch((err: unknown) => {
  // Config errors list variable names only; print them without a stack trace and stop.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
