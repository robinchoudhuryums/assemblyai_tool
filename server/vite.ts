import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";
import { fileURLToPath } from 'url';
import crypto from "crypto";

// Standard Node.js way to get the directory name in an ES module environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        __dirname, // Use the reliable __dirname variable
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      const html = injectCspNonce(page, res, true);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

/**
 * Inject CSP nonce attributes into inline <script> tags and set the
 * Content-Security-Policy header accordingly.
 *
 * In development, Vite injects its own inline scripts, so we keep 'unsafe-inline'
 * as a fallback (browsers that support nonces ignore 'unsafe-inline').
 * In production, the nonce is the sole authorization for inline scripts.
 */
export function injectCspNonce(html: string, res: import("express").Response, isDev: boolean): string {
  const nonce = crypto.randomBytes(16).toString("base64");

  // Add nonce attribute to all inline <script> tags (without src)
  const nonceHtml = html.replace(/<script(?![^>]*\bsrc\b)([^>]*)>/gi, `<script nonce="${nonce}"$1>`);

  // Build CSP: in dev, keep 'unsafe-inline' as fallback for Vite HMR scripts
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'unsafe-inline'`
    : `'self' 'nonce-${nonce}'`;

  res.setHeader("Content-Security-Policy",
    `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss:; frame-ancestors 'none';`
  );

  return nonceHtml;
}

export function serveStatic(app: Express) {
  // Corrected the path to go up one level from /server to find the /dist folder
  const distPath = path.resolve(__dirname, "..", "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist — inject CSP nonce
  const indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
  app.use("*", (_req, res) => {
    const html = injectCspNonce(indexHtml, res, false);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  });
}
