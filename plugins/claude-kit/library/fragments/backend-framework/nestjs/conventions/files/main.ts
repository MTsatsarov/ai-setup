import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Express 5 defaults to the 'simple' query parser, which cannot express the
  // nested filters[0][field]=... form a paginated request uses — it would hand
  // the DTO an empty filters array and silently ignore every filter. 'extended'
  // is the qs parser Express 4 used by default.
  app.set('query parser', 'extended');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('<% project.name %>').build()));
  await app.listen(process.env.PORT ?? 3311);
}
bootstrap();
