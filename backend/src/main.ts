// Carica `backend/.env` in `process.env`. **Deve restare il primo import**: gli
// import sono valutati in ordine, e `AuctionGateway` legge gli origin CORS nel
// suo decoratore, cioè quando il modulo viene importato — non a runtime.
// In produzione è un no-op innocuo: il file non esiste (Render inietta le env) e
// dotenv non sovrascrive mai una variabile già presente nell'ambiente.
import 'dotenv/config';
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
