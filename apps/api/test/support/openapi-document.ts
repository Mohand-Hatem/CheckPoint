import { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { buildOpenApiDocument } from '../../src/swagger';

/**
 * Builds the OpenAPI document from the real controllers without a database
 * (PrismaService is stubbed because no route is called). Used by the generator script and the drift test.
 */
export async function generateOpenApiDocument(): Promise<OpenAPIObject> {
  if (!process.env.JWT_ACCESS_SECRET) {
    process.env.JWT_ACCESS_SECRET = 'openapi-generation-only';
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  const document = buildOpenApiDocument(app);
  await app.close();
  return document;
}
