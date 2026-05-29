import {beforeEach, describe, expect, it, vi} from "vitest";
import {OverlayEventBus} from "../../../src/sportmonks/OverlayEventBus";
import type {OverlayPayload, OverlayWriter} from "../../../src/sportmonks/OverlayEventBus";

function makePayload(sessionId: number = 1): OverlayPayload {
    return {
        sessionId,
        name: "Test Session",
        endedAt: null,
        fixtures: [],
        missingFixtureIds: [],
        serverTime: Date.now(),
    };
}

describe("OverlayEventBus", () => {
    let bus: OverlayEventBus;

    beforeEach(() => {
        bus = new OverlayEventBus();
    });

    describe("subscribe()", () => {
        it("registers a writer and returns an unsubscribe function", () => {
            const writer = vi.fn().mockReturnValue(true);
            const unsub = bus.subscribe(1, writer);
            expect(typeof unsub).toBe("function");
        });

        it("broadcasts to the registered writer", () => {
            const writer = vi.fn().mockReturnValue(true);
            bus.subscribe(1, writer);
            const payload = makePayload(1);
            bus.broadcast(1, payload);
            expect(writer).toHaveBeenCalledWith(payload);
        });

        it("evicts a previous writer by sending a terminal frame when a new subscriber replaces it", () => {
            const oldWriter: OverlayWriter = vi.fn().mockReturnValue(true);
            const newWriter: OverlayWriter = vi.fn().mockReturnValue(true);

            bus.subscribe(1, oldWriter);
            bus.subscribe(1, newWriter);

            // Old writer should have received a terminal eviction frame
            expect(oldWriter).toHaveBeenCalledTimes(1);
            const evictFrame = vi.mocked(oldWriter).mock.calls[0][0];
            expect(evictFrame.endedAt).toEqual(new Date(0));

            // After eviction the new writer is installed; a broadcast should
            // reach the new one only.
            const payload = makePayload(1);
            bus.broadcast(1, payload);
            expect(newWriter).toHaveBeenCalledWith(payload);
        });

        it("does NOT send a terminal eviction frame when subscribing to an empty slot", () => {
            const writer: OverlayWriter = vi.fn().mockReturnValue(true);
            bus.subscribe(1, writer);
            // First subscribe: no prior writer → writer should not have been called yet
            expect(writer).not.toHaveBeenCalled();
        });

        it("swallows exceptions thrown by the evicted prior writer", () => {
            const oldWriter: OverlayWriter = vi.fn().mockImplementation(() => {
                throw new Error("socket broken");
            });
            const newWriter: OverlayWriter = vi.fn().mockReturnValue(true);
            bus.subscribe(1, oldWriter);
            expect(() => bus.subscribe(1, newWriter)).not.toThrow();
        });
    });

    describe("unsubscribe (returned cleanup function)", () => {
        it("removes the writer so subsequent broadcasts are silently dropped", () => {
            const writer = vi.fn().mockReturnValue(true);
            const unsub = bus.subscribe(1, writer);
            unsub();
            bus.broadcast(1, makePayload(1));
            expect(writer).not.toHaveBeenCalled();
        });

        it("is a no-op if a later subscribe already displaced the writer", () => {
            const first: OverlayWriter = vi.fn().mockReturnValue(true);
            const second: OverlayWriter = vi.fn().mockReturnValue(true);

            const unsubFirst = bus.subscribe(1, first);
            bus.subscribe(1, second); // displaces first

            // Calling the stale unsubscribe must not remove the second writer
            unsubFirst();

            bus.broadcast(1, makePayload(1));
            expect(second).toHaveBeenCalled();
        });
    });

    describe("broadcast()", () => {
        it("does nothing when no writer is registered for the session", () => {
            expect(() => bus.broadcast(42, makePayload(42))).not.toThrow();
        });

        it("evicts the writer when it returns false (dead socket)", () => {
            const deadWriter: OverlayWriter = vi.fn().mockReturnValue(false);
            bus.subscribe(1, deadWriter);
            bus.broadcast(1, makePayload(1));

            // A second broadcast should be silently dropped (writer is gone)
            vi.clearAllMocks();
            bus.broadcast(1, makePayload(1));
            expect(deadWriter).not.toHaveBeenCalled();
        });

        it("evicts the writer when it throws", () => {
            const throwingWriter: OverlayWriter = vi.fn().mockImplementation(() => {
                throw new Error("network error");
            });
            bus.subscribe(1, throwingWriter);
            expect(() => bus.broadcast(1, makePayload(1))).not.toThrow();

            // Writer should be gone now
            vi.clearAllMocks();
            bus.broadcast(1, makePayload(1));
            expect(throwingWriter).not.toHaveBeenCalled();
        });

        it("does not evict a concurrently-replaced writer when the original returns false", () => {
            // Simulates: broadcast starts with writerA, which returns false, but
            // by the time the eviction guard runs, writerB has already taken the slot.
            const writerB: OverlayWriter = vi.fn().mockReturnValue(true);
            let writerBInstalled = false;

            const writerA: OverlayWriter = vi.fn().mockImplementation(() => {
                if (!writerBInstalled) {
                    bus.subscribe(1, writerB);
                    writerBInstalled = true;
                }
                return false; // signals dead, but writerB now owns the slot
            });

            bus.subscribe(1, writerA);
            bus.broadcast(1, makePayload(1));

            // writerB should still be registered
            vi.clearAllMocks();
            bus.broadcast(1, makePayload(1));
            expect(writerB).toHaveBeenCalled();
        });
    });

    describe("subscribedSessionIds()", () => {
        it("returns an empty array when no writers are registered", () => {
            expect(bus.subscribedSessionIds()).toEqual([]);
        });

        it("returns the session IDs of active subscribers", () => {
            const w = vi.fn().mockReturnValue(true);
            bus.subscribe(1, w);
            bus.subscribe(2, w);
            expect(bus.subscribedSessionIds().sort()).toEqual([1, 2]);
        });

        it("no longer includes a session id after it is unsubscribed", () => {
            const w = vi.fn().mockReturnValue(true);
            const unsub = bus.subscribe(5, w);
            unsub();
            expect(bus.subscribedSessionIds()).toEqual([]);
        });

        it("no longer includes a session id after the writer dies (returns false)", () => {
            const deadWriter: OverlayWriter = vi.fn().mockReturnValue(false);
            bus.subscribe(7, deadWriter);
            bus.broadcast(7, makePayload(7));
            expect(bus.subscribedSessionIds()).toEqual([]);
        });
    });
});
