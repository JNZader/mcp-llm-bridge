import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "../KpiCard.tsx";
import { Activity } from "lucide-react";

describe("KpiCard", () => {
  it("renders title and value", () => {
    render(<KpiCard title="Total Requests" value={1234} />);

    expect(screen.getByText("Total Requests")).toBeInTheDocument();
    expect(screen.getByText("1234")).toBeInTheDocument();
  });

  it("renders string value", () => {
    render(<KpiCard title="Version" value="1.2.3" />);

    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getByText("1.2.3")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(<KpiCard title="Cost" value="$5.50" subtitle="last 24 hours" />);

    expect(screen.getByText("last 24 hours")).toBeInTheDocument();
  });

  it("does not render subtitle when not provided", () => {
    const { container } = render(<KpiCard title="Cost" value="$5.50" />);

    const subtitles = container.querySelectorAll(".text-xs.text-muted-foreground");
    expect(subtitles).toHaveLength(0);
  });

  it("renders icon when provided", () => {
    render(<KpiCard title="Activity" value={42} icon={Activity} />);

    // lucide-react renders an SVG element
    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <KpiCard title="Test" value={0} className="custom-class" />,
    );

    const card = container.firstElementChild;
    expect(card?.className).toContain("custom-class");
  });
});
