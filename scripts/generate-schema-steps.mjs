/**
 * Regenerates the artifacts derived from schema.sql.
 *
 *   npm run db:schema:generate
 *
 * Run this after editing schema.sql. src/lib/schemaSingleSource.test.ts fails
 * while a generated artifact is stale, so `npm test` covers the same check.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  readSchemaSql,
  renderLegacyMigration,
  renderWorkerStepsModule,
} from "./schema-source.mjs";

const schemaSql = readSchemaSql();
const outputs = [
  {
    path: fileURLToPath(new URL("../worker/schemaSteps.generated.ts", import.meta.url)),
    content: renderWorkerStepsModule(schemaSql),
  },
  {
    path: fileURLToPath(new URL("../schema.migration.sql", import.meta.url)),
    content: renderLegacyMigration(schemaSql),
  },
];

for (const { path, content } of outputs) {
  writeFileSync(path, content, "utf8");
  console.log(`wrote ${path}`);
}
