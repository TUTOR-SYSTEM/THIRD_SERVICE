import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './features/email/email.module';
import { RedisModule } from './features/redis/redis.module';
import { NotificationModule } from './features/notification/notification.module';
import { LogModule } from './features/log/log.module';
import { JwtAuthGuard, LanguageGuard, TokenBucketGuard } from '@packages/guards';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { UploadModule } from './features/uploads/upload.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    EmailModule,
    RedisModule,
    NotificationModule,
    LogModule,
    UploadModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: LanguageGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TokenBucketGuard,
    },
  ],
})
export class AppModule {}
