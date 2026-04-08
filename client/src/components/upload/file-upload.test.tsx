import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  // Stub QueryClient so importing @/lib/queryClient (which constructs one
  // at module load) doesn't blow up. A10 added a getCsrfToken import from
  // queryClient, which transitively pulls in the full module.
  QueryClient: class { constructor() { /* noop */ } },
}));

// A10: file-upload.tsx now imports getCsrfToken from @/lib/queryClient.
// Stub the module so the test doesn't need the real QueryClient construction.
vi.mock("@/lib/queryClient", () => ({
  getCsrfToken: () => undefined,
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useLocation: () => ["/upload", vi.fn()],
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => {
      const t: Record<string, string> = {
        "upload.title": "Upload Calls",
        "upload.dropzone": "Drop audio files here, or click to browse",
        "upload.formats": "Supported: MP3, WAV, M4A, FLAC, OGG, WebM",
        "action.upload": "Upload",
        "action.uploadAll": "Upload All",
        "lang.auto": "Auto-detect",
        "lang.en": "English",
        "lang.es": "Spanish",
      };
      return t[key] || key;
    },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("react-dropzone", () => ({
  useDropzone: vi.fn(({ onDrop }: any) => ({
    getRootProps: () => ({ "data-testid": "dropzone" }),
    getInputProps: () => ({ "data-testid": "dropzone-input" }),
    isDragActive: false,
    open: vi.fn(),
  })),
}));

import FileUpload from "./file-upload";

describe("FileUpload", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the upload component", () => {
    render(<FileUpload />);
    expect(screen.getByTestId("dropzone")).toBeInTheDocument();
  });

  it("renders the dropzone area", () => {
    render(<FileUpload />);
    expect(screen.getByTestId("dropzone")).toBeInTheDocument();
  });

  it("shows supported format text", () => {
    render(<FileUpload />);
    expect(screen.getByText(/MP3.*WAV.*M4A/i)).toBeInTheDocument();
  });

  it("shows the upload instruction text", () => {
    render(<FileUpload />);
    // The dropzone renders instruction text (may come from i18n key or hardcoded)
    const dropzone = screen.getByTestId("dropzone");
    expect(dropzone).toBeInTheDocument();
    // Verify there's some text content in the dropzone area
    expect(dropzone.textContent!.length).toBeGreaterThan(0);
  });

  it("does not show upload button when no files selected", () => {
    render(<FileUpload />);
    // Upload All button should not be visible when no files are queued
    expect(screen.queryByText("Upload All")).not.toBeInTheDocument();
  });
});
