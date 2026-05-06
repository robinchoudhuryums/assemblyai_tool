/**
 * E2E coverage for the batch quality summary toast on the /upload page.
 *
 * What this proves: when the user uploads >1 file via the dropzone, the
 * page tracks them as a cohort and fires a SINGLE summary toast once
 * every file in the cohort reaches a terminal status. Asserts the
 * happy-path title ("Batch of N complete") + clean-analysis description
 * shape ("N analyzed cleanly"). Unit tests cover the classifyFlag
 * helper in isolation; this is the only spec that drives the cohort
 * watcher end-to-end with real WebSocket events from the pipeline.
 *
 * Why browser-required:
 *   The cohort watcher (file-upload.tsx:136-186) is a useEffect over
 *   React state + WebSocket-dispatched events. There's no API surface
 *   to test it through. Drives the dropzone via setInputFiles on the
 *   hidden <input type="file">, which react-dropzone backs with.
 *
 * Why MSW mocks make this safe:
 *   The MSW handlers (server/test-mocks/handlers.ts) return a clean
 *   analysis JSON with `flags: []`. So the cohort resolves with two
 *   "completed cleanly" entries — the toast description should be
 *   "2 analyzed cleanly". If the MSW handlers ever change to inject
 *   a flag, this spec's description assertion needs updating.
 *
 * Flake risk:
 *   - WebSocket connection timing. The page mounts → useWebSocket
 *     connects → after that, upload completion events arrive. If the
 *     upload finishes BEFORE WS connects, the completion event is lost
 *     and the toast never fires. Mitigation: 30s timeout on the toast
 *     assertion (CI retries=2 absorbs the rest).
 *   - SHA-256 dedup: each test run must use unique buffers.
 *     Buffer.from(`...-${Date.now()}-N`) gives us run-unique +
 *     within-run-unique payloads.
 */
import { test, expect } from "@playwright/test";
import { dismissMfaSetupPromptIfPresent } from "./_helpers";

test.describe("Upload page batch quality summary toast", () => {
  // Test-level timeout bumped — full upload→pipeline→WS chain runs
  // 2 jobs through MSW-mocked AssemblyAI + Bedrock; in CI runners
  // the cumulative latency can exceed the default 30s spec timeout.
  // 90s is generous; if this still flakes we want to see WHERE.
  test.setTimeout(120_000);

  test("uploading 2 clean files fires one summary toast", async ({ page }) => {
    // Login
    await page.goto("/");
    await page.getByPlaceholder(/username/i).fill("testadmin");
    await page.getByPlaceholder(/password/i).fill("TestPass123!");
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 10_000 });
    await dismissMfaSetupPromptIfPresent(page);

    await page.goto("/upload");
    // Brief wait so useWebSocket has a chance to connect before the
    // upload kicks off — otherwise the completion broadcast may arrive
    // before the listener is wired.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

    // Drop 2 unique files into the dropzone's hidden file input.
    // react-dropzone backs the rootProps with an input[type="file"];
    // setInputFiles drives that programmatically without an actual
    // drag-and-drop event.
    const stamp = Date.now();
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      {
        name: "batch-toast-1.mp3",
        mimeType: "audio/mpeg",
        buffer: Buffer.from(`fake-mp3-batch-toast-${stamp}-1`),
      },
      {
        name: "batch-toast-2.mp3",
        mimeType: "audio/mpeg",
        buffer: Buffer.from(`fake-mp3-batch-toast-${stamp}-2`),
      },
    ]);

    // Diagnostic: confirm the dropzone's onDrop handler fired and
    // populated the file list. If this fails, setInputFiles didn't
    // reach react-dropzone — telling us the failure is upstream of
    // the upload itself.
    await expect(page.getByText("batch-toast-1.mp3")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("batch-toast-2.mp3")).toBeVisible({ timeout: 5_000 });

    // The "Upload All" button's text includes a parenthesized count
    // (e.g. "Upload All (2)"). Match by case-insensitive prefix.
    const uploadAllButton = page.getByRole("button", { name: /upload all/i });
    await expect(uploadAllButton).toBeEnabled({ timeout: 5_000 });
    await uploadAllButton.click();

    // Diagnostic separation: the page header shows "(N/M complete)" as
    // soon as a row's UI status hits "completed". That text reflects
    // serverStatus → UI status mapping (file-upload.tsx:431) and
    // appears in the static DOM, NOT a toast portal. So we assert it
    // first — if it appears, the upload→pipeline→WS chain worked end
    // to end. The toast assertion that follows then only tests whether
    // the cohort WATCHER fired correctly given a known-good chain.
    //
    // PR #167 CI run #2 showed the toast assertion timing out at 90s
    // with no other diagnostics failing. That's ambiguous — could be
    // pipeline never completed, OR pipeline completed but watcher
    // didn't fire. This split tells us which.
    await expect(page.getByText("(2/2 complete)")).toBeVisible({ timeout: 120_000 });

    // Now the toast. The watcher fires synchronously inside a useEffect
    // when both files reach terminal serverStatus, so this should
    // appear within a few hundred ms of the (2/2 complete) text. If
    // this fails while (2/2 complete) succeeded, the bug is in the
    // cohort watcher's useEffect dependency array or its fire
    // condition — not in the upload pipeline.
    await expect(page.getByText("Batch of 2 complete")).toBeVisible({ timeout: 10_000 });

    // MSW handlers return clean analysis (flags: []), so the cohort
    // resolves with 2 clean files and the description should say
    // "2 analyzed cleanly". If MSW ever starts injecting flags, the
    // description shape changes — fix this assertion or move it under
    // a separate dirty-batch test.
    await expect(page.getByText("2 analyzed cleanly")).toBeVisible({ timeout: 5_000 });
  });
});
