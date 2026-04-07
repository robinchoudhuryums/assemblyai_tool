import { Router } from "express";
import multer from "multer";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { insertEmployeeSchema, assignCallSchema } from "@shared/schema";
import { z } from "zod";
import { sendError, sendValidationError, validateIdParam, cleanupFile } from "./utils";
import csv from "csv-parser";
import fs from "fs";
import path from "path";

// A29/F32-F34: accept CSV as multipart upload (2MB cap) instead of reading
// a hard-coded server-side file path.
const csvUpload = multer({
  dest: "uploads/",
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.toLowerCase().endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only .csv files are accepted") as unknown as null, false);
    }
  },
});

// Row-level Zod schema — rejects rows with missing/overlong fields.
const csvRowSchema = z.object({
  name: z.string().min(1).max(100),
  department: z.string().max(100).optional(),
  extension: z.string().max(50).optional(),
  pseudonym: z.string().max(100).optional(),
  status: z.enum(["Active", "Inactive"]).default("Active"),
});

export function register(router: Router) {
  // Get employees (A20/F31): SQL-level pagination. Silent default limit=50,
  // max=500. Clients not sending limit get X-Pagination-Default: true for
  // visibility while the frontend migrates.
  router.get("/api/employees", requireAuth, async (req, res) => {
    try {
      const rawLimit = parseInt(req.query.limit as string);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 50;
      const rawOffset = parseInt(req.query.offset as string);
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      const statusParam = req.query.status;
      const status = statusParam === "Active" || statusParam === "Inactive" ? statusParam : undefined;
      if (!req.query.limit) {
        res.setHeader("X-Pagination-Default", "true");
      }
      const { employees, total } = await storage.getEmployeesPaginated({ limit, offset, status });
      res.setHeader("X-Total-Count", String(total));
      // Transitional shape: return bare array for back-compat with existing
      // frontend callers that expect an Employee[]. Total available via header.
      res.json(employees);
    } catch (error) {
      res.status(500).json({ message: "Failed to get employees" });
    }
  });

  // HIPAA: Only managers and admins can create employees
  router.post("/api/employees", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const validatedData = insertEmployeeSchema.parse(req.body);
      const employee = await storage.createEmployee(validatedData);
      res.status(201).json(employee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendValidationError(res, "Invalid employee data", error);
      } else {
        sendError(res, 500, "Failed to create employee");
      }
    }
  });

  // HIPAA: Only managers and admins can update employees
  const updateEmployeeSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email().optional(),
    role: z.string().max(100).optional(),
    status: z.enum(["Active", "Inactive"]).optional(),
    initials: z.string().max(2).optional(),
    subTeam: z.string().max(100).optional(),
  }).strict();

  router.patch("/api/employees/:id", requireAuth, requireRole("manager", "admin"), validateIdParam, async (req, res) => {
    try {
      const parsed = updateEmployeeSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, "Invalid update data", parsed.error);
        return;
      }
      const employee = await storage.getEmployee(req.params.id);
      if (!employee) {
        sendError(res, 404, "Employee not found");
        return;
      }
      const updated = await storage.updateEmployee(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employee" });
    }
  });

  // NOTE: Call assignment (PATCH /api/calls/:id/assign) is handled in calls.ts.
  // Previously duplicated here — removed to maintain single source of truth.

  // HIPAA: Only admins can bulk import employees. Accepts multipart/form-data
  // with a `file` field containing the CSV (A29/F32-F34).
  router.post(
    "/api/employees/import-csv",
    requireAuth,
    requireRole("admin"),
    csvUpload.single("file"),
    async (req, res) => {
      const uploaded = req.file;
      try {
        if (!uploaded) {
          return res.status(400).json({ message: "CSV file upload is required (field name: file)" });
        }

        const MAX_CSV_ROWS = 500;
        const rawRows: Record<string, string>[] = [];

        await new Promise<void>((resolve, reject) => {
          fs.createReadStream(uploaded.path)
            .pipe(csv())
            .on("data", (row: Record<string, string>) => {
              if (rawRows.length < MAX_CSV_ROWS) rawRows.push(row);
            })
            .on("end", () => resolve())
            .on("error", reject);
        });

        if (rawRows.length === 0) {
          return res.status(400).json({ message: "CSV file is empty or has no valid rows" });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const results: Array<{ name: string; action: string }> = [];

        for (const row of rawRows) {
          const parsed = csvRowSchema.safeParse({
            name: (row["Agent Name"] || "").trim(),
            department: (row["Department"] || "").trim() || undefined,
            extension: (row["Extension"] || "").trim().replace(/[^\w.-]/g, "") || undefined,
            pseudonym: (row["Pseudonym"] || row["Display Name"] || "").trim() || undefined,
            status: ((row["Status"] || "Active").trim() as "Active" | "Inactive"),
          });
          if (!parsed.success) {
            results.push({ name: row["Agent Name"] || "(unknown)", action: "skipped (validation)" });
            continue;
          }
          const { name, department, extension, pseudonym, status } = parsed.data;

          const email = extension && extension !== "NA" && extension !== "N/A" && extension !== "a"
            ? `${extension}@company.com`
            : `${name.toLowerCase().replace(/\s+/g, ".")}@company.com`;

          if (!emailRegex.test(email)) {
            results.push({ name, action: "skipped (invalid email)" });
            continue;
          }

          const nameParts = name.split(/\s+/);
          const initials = nameParts.length >= 2
            ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
            : name.slice(0, 2).toUpperCase();

          const validExtension = extension && extension !== "NA" && extension !== "N/A" && extension !== "a"
            ? extension : undefined;

          try {
            const existing = await storage.getEmployeeByEmail(email);
            if (existing) {
              if ((pseudonym || validExtension) && (!existing.pseudonym && !existing.extension)) {
                await storage.updateEmployee(existing.id, {
                  pseudonym: pseudonym || existing.pseudonym,
                  extension: validExtension || existing.extension,
                });
                results.push({ name, action: "updated (pseudonym/extension)" });
              } else {
                results.push({ name, action: "skipped (exists)" });
              }
            } else {
              await storage.createEmployee({
                name, email, role: department || "", initials, status,
                pseudonym: pseudonym || undefined,
                extension: validExtension,
              });
              results.push({ name, action: "created" });
            }
          } catch (err) {
            // Sanitized: don't leak internal error messages to response.
            console.warn(`[CSV import] Row failed for ${name}:`, (err as Error).message);
            results.push({ name, action: "error (row failed)" });
          }
        }

        const created = results.filter(r => r.action === "created").length;
        const skipped = results.filter(r => r.action.startsWith("skipped")).length;
        res.json({ message: `Import complete: ${created} created, ${skipped} skipped`, details: results });
      } catch (error) {
        console.error("CSV import failed:", (error as Error).message);
        res.status(500).json({ message: "Failed to import CSV" });
      } finally {
        if (uploaded?.path) await cleanupFile(uploaded.path);
      }
    },
  );
}
