import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  const baseProps = {
    title: "Delete call?",
    description: "This action cannot be undone.",
    onOpenChange: () => { /* noop */ },
    onConfirm: () => { /* noop */ },
  };

  it("does not render when open=false", () => {
    render(<ConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByText("Delete call?")).toBeNull();
  });

  it("renders title and description when open=true", () => {
    render(<ConfirmDialog {...baseProps} open />);
    expect(screen.getByText("Delete call?")).toBeTruthy();
    expect(screen.getByText("This action cannot be undone.")).toBeTruthy();
  });

  it("uses the custom confirmLabel when provided", () => {
    render(<ConfirmDialog {...baseProps} open confirmLabel="Yes, delete" />);
    expect(screen.getByText("Yes, delete")).toBeTruthy();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} open />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...baseProps} onOpenChange={onOpenChange} open />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("applies destructive styling when variant=destructive", () => {
    render(<ConfirmDialog {...baseProps} open variant="destructive" />);
    const confirmBtn = screen.getByText("Confirm");
    expect(confirmBtn.className).toMatch(/destructive/);
  });
});
