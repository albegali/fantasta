import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { corsOrigins } from './config/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
   
  console.log(`Fantasta Auction API sulla porta ${port} — origin: ${corsOrigins().join(', ')}`);
}
bootstrap();
