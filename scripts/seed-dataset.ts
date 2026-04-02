import "dotenv/config";

import { loadSeedEvalRows, seedBraintrustDataset } from "../src/braintrust/dataset.js";

const rows = await loadSeedEvalRows();
const result = await seedBraintrustDataset(rows);

if (result.skipped) {
  console.log(`Loaded ${rows.length} seed rows locally. Braintrust dataset upload was skipped.`);
} else {
  console.log(`Uploaded ${result.uploaded} rows to Braintrust dataset.`);
  console.log(JSON.stringify(result.summary, null, 2));
}
