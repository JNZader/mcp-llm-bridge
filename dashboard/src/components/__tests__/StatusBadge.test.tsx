import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../StatusBadge.tsx";

describe("StatusBadge", () => {
  it("renders the status text", () => {
    render(<StatusBadge status="available" />);
    expect(screen.getByText("available")).toBeInTheDocument();
  });

  it("renders with outline variant", () => {
    render(<StatusBadge status="OPEN" variant="outline" />);
    expect(screen.getByText("OPEN")).toBeInTheDocument();
  });

  it("applies success colors for available status", () => {
    render(<StatusBadge status="available" />);
    const badge = screen.getByText("available");
    expect(badge.className).toContain("text-success");
  });

  it("applies destructive colors for unavailable status", () => {
    render(<StatusBadge status="unavailable" />);
    const badge = screen.getByText("unavailable");
    expect(badge.className).toContain("text-destructive");
  });

  it("applies warning colors for HALF_OPEN status", () => {
    render(<StatusBadge status="HALF_OPEN" />);
    const badge = screen.getByText("HALF_OPEN");
    expect(badge.className).toContain("text-warning");
  });

  it("applies success colors for CLOSED circuit breaker", () => {
    render(<StatusBadge status="CLOSED" />);
    const badge = screen.getByText("CLOSED");
    expect(badge.className).toContain("text-success");
  });

  it("applies destructive colors for OPEN circuit breaker", () => {
    render(<StatusBadge status="OPEN" />);
    const badge = screen.getByText("OPEN");
    expect(badge.className).toContain("text-destructive");
  });

  it("falls back to muted colors for unknown status", () => {
    render(<StatusBadge status="unknown-status" />);
    const badge = screen.getByText("unknown-status");
    expect(badge.className).toContain("text-muted-foreground");
  });

  it("applies outline variant colors correctly", () => {
    render(<StatusBadge status="available" variant="outline" />);
    const badge = screen.getByText("available");
    expect(badge.className).toContain("bg-transparent");
  });
});
