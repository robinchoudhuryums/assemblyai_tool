import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { insertEmployeeSchema, assignCallSchema } from "@shared/schema";
import { z } from "zod";
import { sendError, sendValidationError, validateIdParam } from "./utils";
import csv from "csv-parser";
import fs from "fs";
import path from "path";

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

  // HIPAA: Only admins can bulk import employees
  router.post("/api/employees/import-csv", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const csvFilePath = path.resolve("employees.csv");
      if (!fs.existsSync(csvFilePath)) {
        res.status(404).json({ message: "employees.csv not found on server" });
        return;
      }

      const MAX_CSV_ROWS = 500;
      const results: Array<{ name: string; action: string }> = [];
      const rows: any[] = [];

      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(csvFilePath)
          .pipe(csv())
          .on("data", (row: any) => {
            if (rows.length < MAX_CSV_ROWS) rows.push(row);
          })
          .on("end", resolve)
          .on("error", reject);
      });

      if (rows.length === 0) {
        res.status(400).json({ message: "CSV file is empty or has no valid rows" });
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      for (const row of rows) {
        const name = (row["Agent Name"] || "").trim();
        const department = (row["Department"] || "").trim();
        const extension = (row["Extension"] || "").trim().replace(/[^\w.-]/g, "");
        const pseudonym = (row["Pseudonym"] || row["Display Name"] || "").trim();
        const status = (row["Status"] || "Active").trim();

        if (!name || name.length > 100) continue;

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
            // Update pseudonym/extension if provided and not already set
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
              name, email, role: department, initials, status,
              pseudonym: pseudonym || undefined,
              extension: validExtension,
            });
            results.push({ name, action: "created" });
          }
        } catch (err) {
          results.push({ name, action: `error: ${(err as Error).message}` });
        }
      }

      const created = results.filter(r => r.action === "created").length;
      const skipped = results.filter(r => r.action.startsWith("skipped")).length;
      res.json({ message: `Import complete: ${created} created, ${skipped} skipped`, details: results });
    } catch (error) {
      console.error("CSV import failed:", error);
      res.status(500).json({ message: "Failed to import employees from CSV" });
    }
  });
}
