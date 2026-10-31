/**
 * Writes docs/api/openapi.json, the file you import into Apidog / Postman / Insomnia.
 * Run `npm run docs:openapi` after adding or changing any route; the swagger.spec.ts test fails if you forget.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { generateOpenApiDocument } from '../test/support/openapi-document';

async function main() {
  const document = await generateOpenApiDocument();
  const out = join(__dirname, '..', '..', '..', 'docs', 'api', 'openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n', 'utf-8');

  const operations = Object.values(document.paths).reduce((n, item) => n + Object.keys(item).length, 0);
  console.log(`✅ ${operations} operations written to docs/api/openapi.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
