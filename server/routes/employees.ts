import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { insertEmployeeSchema } from "@shared/schema";
import { z } from "zod";
import csv from "csv-parser";
import fs from "fs";
import path from "path";

export function register(router: Router) {
  // Get all employees
  router.get("/api/employees", requireAuth, async (req, res) => {
    try {
      const employees = await storage.getAllEmployees();
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
        res.status(400).json({ message: "Invalid employee data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create employee" });
      }
    }
  });

  // HIPAA: Only managers and admins can update employees
  const updateEmployeeSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z.string().optional(),
    status: z.string().optional(),
    initials: z.string().max(2).optional(),
    subTeam: z.string().optional(),
  }).strict();

  router.patch("/api/employees/:id", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = updateEmployeeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
        return;
      }
      const employee = await storage.getEmployee(req.params.id);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }
      const updated = await storage.updateEmployee(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employee" });
    }
  });

  // Assign/reassign employee to a call (managers and admins only)
  const assignCallSchema = z.object({
    employeeId: z.string().optional(),
  }).strict();

  router.patch("/api/calls/:id/assign", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = assignCallSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request data", errors: parsed.error.flatten() });
        return;
      }
      const { employeeId } = parsed.data;
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }
      if (employeeId) {
        const employee = await storage.getEmployee(employeeId);
        if (!employee) {
          res.status(404).json({ message: "Employee not found" });
          return;
        }
      }
      const updated = await storage.updateCall(req.params.id, { employeeId: employeeId || undefined });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign employee to call" });
    }
  });

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
