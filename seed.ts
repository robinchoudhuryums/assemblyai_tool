import 'dotenv/config';
import fs from 'fs';
import csv from 'csv-parser';
import { storage } from './server/storage'; // Make sure this path is correct

const csvFilePath = './employees.csv'; // The CSV file you uploaded

async function syncFromCSV() {
  const employeesFromCSV: any[] = [];

  console.log('Reading employees from CSV file...');

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      // Reads from the "Name", "Department", and "Extension" columns in your CSV
    employeesFromCSV.push({
    name: row["Agent Name"], // This now correctly reads the "Agent Name" column
    role: row.Department,
    email: `${row.Extension}@company.com`,
    initials: row["Agent Name"] ? row["Agent Name"].split(' ').map((n: string) => n[0]).join('') : 'XX',
    });
    })
    .on('end', async () => {
      console.log('CSV file successfully processed. Starting database sync...');
      
      for (const employee of employeesFromCSV) {
        if (!employee.name) {
            console.log("Skipping empty row...");
            continue;
        }
        try {
          await storage.createEmployee(employee);
          console.log(`Synced: ${employee.name}`);
        } catch (error) {
          console.error(`Failed to sync ${employee.name}:`, error);
        }
      }
      
      console.log('Database sync complete!');
      // process.exit(0) is removed to allow the script to exit naturally in Codespaces
    });
}

syncFromCSV();