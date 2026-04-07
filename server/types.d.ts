// Express type augmentations — single source of truth.
// @types/multer provides the multer type definitions (A39/F64).

declare global {
  namespace Express {
    interface User {
      id: string;
      username: string;
      name: string;
      role: string;
    }
  }
}

export {};
