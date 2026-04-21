import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { storage } from './server/storage';
import {
  isSimulatedCallsAvailable,
  listSimulatedCalls,
  createSimulatedCall,
} from './server/services/simulated-call-storage';
import {
  simulatedCallScriptSchema,
  simulatedCallConfigSchema,
} from './shared/simulated-call-schema';
const csvFilePath = './employees.csv';
const PRESETS_DIR = './seed/simulated-call-presets';

async function syncFromCSV() {
  const employeesFromCSV: any[] = [];
  console.log('Reading employees from CSV file...');

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      const name = row["Agent Name"] || '';
      const nameParts = name.trim().split(/\s+/);
      const initials = nameParts.length >= 2
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase();

      employeesFromCSV.push({
        name,
        role: row.Department,
        email: `${row.Extension}@company.com`,
        initials,
        status: row.Status,
      });
    })
    .on('end', async () => {
      console.log('CSV file successfully processed. Starting cloud sync...');
      for (const employee of employeesFromCSV) {
        if (!employee.name || !employee.email) {
          console.log("Skipping row with missing name or email...");
          continue;
        }
        try {
          const existingEmployee = await storage.getEmployeeByEmail(employee.email);

          if (existingEmployee) {
            // If employee exists, update their status if it's different
            if (existingEmployee.status !== employee.status) {
              await storage.updateEmployee(existingEmployee.id, { status: employee.status });
              console.log(`Updated status for: ${employee.name} to ${employee.status}`);
            } else {
              console.log(`Skipping existing employee: ${employee.name}`);
            }
          } else {
            // If employee does not exist, create them
            await storage.createEmployee(employee);
            console.log(`Created new employee: ${employee.name}`);
          }
        } catch (error) {
          console.error(`Failed to sync ${employee.name}:`, error);
        }
      }
      console.log('Sync complete!');
    });
}

async function seedSimulatedCallPresets() {
  if (!isSimulatedCallsAvailable()) {
    console.log("[presets] DATABASE_URL not set — skipping simulated-call preset seeding.");
    return;
  }
  if (!fs.existsSync(PRESETS_DIR)) {
    console.log(`[presets] directory ${PRESETS_DIR} not found — skipping.`);
    return;
  }
  const files = fs
    .readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log(`[presets] no preset JSON files in ${PRESETS_DIR}.`);
    return;
  }

  // Idempotency: seed only presets that don't already exist by title under
  // the "system" creator. If an admin deletes a preset they probably don't
  // want it respawned on the next seed — but that's the tradeoff for a
  // simple title-based check. Manually-created rows are untouched.
  const existing = await listSimulatedCalls({ createdBy: "system", limit: 500 });
  const existingTitles = new Set(existing.map((c) => c.title));

  let created = 0;
  for (const file of files) {
    const fullPath = path.join(PRESETS_DIR, file);
    try {
      const raw = fs.readFileSync(fullPath, "utf-8");
      const json = JSON.parse(raw);
      const scriptParsed = simulatedCallScriptSchema.safeParse(json);
      if (!scriptParsed.success) {
        console.warn(`[presets] ${file} — invalid script shape, skipping`);
        continue;
      }
      if (existingTitles.has(scriptParsed.data.title)) {
        continue;
      }
      // Sensible default config: natural gap timing, phone codec, no noise.
      // Also attach a tier-based expectedScoreRange so these seeded presets
      // immediately appear in the calibration suite (#1 roadmap). Ranges are
      // deliberately conservative — they'll catch large regressions (1+ point
      // drift) without false-positive-ing on normal model variance.
      const tier = scriptParsed.data.qualityTier;
      const expectedScoreRange =
        tier === "excellent" ? { min: 8.0, max: 10.0 } :
        tier === "acceptable" ? { min: 5.5, max: 7.5 } :
        tier === "poor" ? { min: 2.0, max: 4.5 } :
        undefined;
      const config = simulatedCallConfigSchema.parse({
        ...(expectedScoreRange ? { expectedScoreRange } : {}),
      });
      await createSimulatedCall({
        title: scriptParsed.data.title,
        scenario: scriptParsed.data.scenario,
        qualityTier: scriptParsed.data.qualityTier,
        equipment: scriptParsed.data.equipment,
        script: scriptParsed.data,
        config,
        createdBy: "system",
      });
      console.log(`[presets] seeded: ${scriptParsed.data.title}`);
      created++;
    } catch (err) {
      console.warn(`[presets] failed to process ${file}:`, (err as Error).message);
    }
  }
  console.log(`[presets] seeded ${created} new preset(s) (${existingTitles.size} already existed).`);
}

(async () => {
  syncFromCSV();
  // Run presets independently of the CSV sync (CSV sync is event-driven).
  await seedSimulatedCallPresets().catch((err) => {
    console.error("Preset seeding failed:", err);
  });
})();
