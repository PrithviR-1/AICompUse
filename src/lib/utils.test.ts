// Tests for the class-name helper's knowledge of token utility names.
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a token font size and a token text color together", () => {
    expect(cn("text-body", "text-muted")).toBe("text-body text-muted");
  });

  it("lets a later font size win", () => {
    expect(cn("text-body", "text-caption")).toBe("text-caption");
  });

  it("lets a later radius token win", () => {
    expect(cn("rounded-control", "rounded-card")).toBe("rounded-card");
  });
});
