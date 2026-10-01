import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AUTH_COUNTER, AuthService } from './auth.service';
import { MemoryWindowCounter, RedisWindowCounter, WindowCounter } from '../common/window-counter';
import { LoginLimiter, MemoryLoginLimiter, RedisLoginLimiter } from './login-limiter';
import { REDIS, RedisClient } from '../redis/redis.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => ({
        secret: c.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', expiresIn: c.ACCESS_TOKEN_TTL_S },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    { provide: LoginLimiter, inject: [REDIS], useFactory: (redis: RedisClient) => (redis ? new RedisLoginLimiter(redis) : new MemoryLoginLimiter()) },
    { provide: AUTH_COUNTER, inject: [REDIS], useFactory: (redis: RedisClient): WindowCounter => (redis ? new RedisWindowCounter(redis) : new MemoryWindowCounter()) },
  ],
  exports: [AuthService, AuthGuard, JwtModule],
})
export class AuthModule {}
