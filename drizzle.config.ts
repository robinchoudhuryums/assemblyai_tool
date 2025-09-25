import { defineConfig } from "drizzle-kit";
import "dotenv/config"; // This line loads your .env file and environment variables

export default defineConfig({
  schema: "./server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // This now correctly reads your DATABASE_URL from the Codespaces secrets
    url: process.env.DATABASE_URL!, 
  },
  verbose: true,
  strict: true,
});