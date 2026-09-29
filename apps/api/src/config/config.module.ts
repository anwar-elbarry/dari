import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig, parseEnv } from './env';

@Global()
@Module({})
export class ConfigModule {
  /** Pass an explicit config in tests; otherwise `process.env` is parsed and validated. */
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useFactory: () => config ?? parseEnv(process.env) }],
      exports: [APP_CONFIG],
    };
  }
}
