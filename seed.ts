import 'dotenv/config';
import fs from 'fs';
import csv from 'csv-parser';
import { DbStorage } from './server/storage';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Could not find DATABASE_URL in the .env file.");
}

const storage = new DbStorage(databaseUrl); 
const csvFilePath = './employees.csv';

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
      console.log('CSV file successfully processed. Starting database sync...');
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
      console.log('Database sync complete!');
    });
}

syncFromCSV();