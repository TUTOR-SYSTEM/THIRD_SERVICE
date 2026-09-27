// Load env vars before any other import so a future RmqProducer/ClientsModule
// (module-top-level `process.env.RABBITMQ_URL` reads) never races ConfigModule's
// dotenv loading — see gateway/USER's main.ts for the bug this prevents.
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ResponseInterceptor } from '@packages/interceptor/response.interceptor';
import { ErrorInterceptor, LoggerInterceptor } from '@packages/interceptor';
import { HttpExceptionFilter, RpcExceptionFilter } from '@packages/filters';
import { TraceContextInterceptor } from '@packages/interceptor';
import { setLogSink } from '@packages/context/log-sink';
import { LogService } from './features/log/log.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  app.enableCors({ origin: true, credentials: true });
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalInterceptors(new ErrorInterceptor(), new LoggerInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Own the `request_logs` table locally — write directly instead of round-tripping through
  // RabbitMQ to itself. `TraceContextInterceptor` calls `emitRequestLog()` for every RPC hop.
  const logService = app.get(LogService);
  setLogSink((entry) => logService.createInternal(entry));

  // `deferInitialization: true` is required: by default `connectMicroservice()` synchronously
  // calls `registerListeners()` before returning, which binds every @MessagePattern handler to
  // whatever global filters exist *at that moment* (none) — a `useGlobalFilters()` call after
  // that point is silently too late (Nest logs "Cannot apply global exception filters:
  // registration must occur before initialization" and the base `BaseRpcExceptionFilter`
  // fallback keeps handling errors instead). Deferring means listener registration happens
  // inside `startAllMicroservices()` → `listen()`, after our filter is already in place.
  //
  const rmqMicroservice = app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
        queue: process.env.THIRD_QUEUE ?? 'third_queue',
        queueOptions: { durable: true },
        prefetchCount: 10,
      },
    },
    { deferInitialization: true },
  );

  // Global for this microservice only — every @MessagePattern handler gets it for free, no
  // per-controller @UseFilters(RpcExceptionFilter) needed. Kept off the HTTP `app` global
  // filters (RpcExceptionFilter expects an RPC context, not an Express Response).
  rmqMicroservice.useGlobalFilters(new RpcExceptionFilter());
  // Opens the correlationId/traceId/serviceName RequestContext for every @MessagePattern
  // handler — see [[rmq-rpc-plumbing]] memory.
  rmqMicroservice.useGlobalInterceptors(new TraceContextInterceptor());

  const config = new DocumentBuilder()
    .setTitle('Backends API')
    .setDescription('API documentation for the Backends financial management system')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT access token',
      },
      'access-token',
    )
    // ── Tutor Management ─────────────────────────────
    .addTag('Users')
    .addTag('Auth')
    .addTag('Students')
    .addTag('Curriculum')
    .addTag('Chapter')
    .addTag('Lesson')
    .addTag('Classes')
    .addTag('Schedules')
    .addTag('Sessions')
    .addTag('Exercises')
    .addTag('Tuitions')
    .addTag('Notifications')
    // ── Finance Management ────────────────────────────
    .addTag('Categories')
    .addTag('Wallets')
    .addTag('Transactions')
    .addTag('Reports')
    // ── System ────────────────────────────────────────
    .addTag('Upload')
    .addTag('Cloudinary')
    .addTag('Health')
    .addTag('Redis')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.startAllMicroservices();
  Logger.log(
    `[THIRD] RabbitMQ listener bound (queue "${process.env.THIRD_QUEUE ?? 'third_queue'}")`,
    'Bootstrap',
  );

  const port = process.env.PORT ?? 8888;
  await app.listen(port);
  Logger.log(`[THIRD] listening on port ${port}`, 'Bootstrap');
}
void bootstrap();
