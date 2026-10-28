import { describe, it, expect } from "vitest";
import { parkDoor, takeDoor } from "../lib/doorBuffer";

describe("doorBuffer — a door fired before the tab mounted is not lost", () => {
  it("hands over the newest parked event once, then nothing", () => {
    parkDoor("docs:open", "a", 1_000);
    parkDoor("docs:open", "b", 2_000);
    expect(takeDoor("docs:open", 15_000, 3_000)).toBe("b");
    expect(takeDoor("docs:open", 15_000, 3_000)).toBeUndefined();
  });
  it("drops a stale door — a door is a request made now", () => {
    parkDoor("docs:search", "type:term", 1_000);
    expect(takeDoor("docs:search", 15_000, 20_000)).toBeUndefined();
  });
});
