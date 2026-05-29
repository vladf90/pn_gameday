import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../../src/sportmonks/metrics", () => ({
    sportmonksActiveFixtureIds: {set: vi.fn()},
    sportmonksPollerLastSuccessTimestamp: {set: vi.fn()},
}));

vi.mock("../../../src/Logger", () => ({
    Logger: vi.fn().mockImplementation(() => ({
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    })),
}));

import {FixturePoller} from "../../../src/sportmonks/FixturePoller";
import type {FixturesClient} from "../../../src/sportmonks/clients/FixturesClient";
import type {FixtureSelectionProvider} from "../../../src/sportmonks/FixtureSelectionProvider";
import type {LiveSnapshotStore} from "../../../src/sportmonks/LiveSnapshotStore";
import {
    sportmonksActiveFixtureIds,
    sportmonksPollerLastSuccessTimestamp,
} from "../../../src/sportmonks/metrics";
import type {LiveFixture} from "../../../src/sportmonks/types";

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeClient(fixtures: LiveFixture[] = []): FixturesClient {
    return {
        getMulti: vi.fn().mockResolvedValue(fixtures),
    } as unknown as FixturesClient;
}

function makeProvider(ids: number[] = []): FixtureSelectionProvider {
    return {
        getActiveFixtureIds: vi.fn().mockResolvedValue(ids),
    };
}

function makeStore(): LiveSnapshotStore {
    return {
        replaceMany: vi.fn(),
        evictMissing: vi.fn(),
    } as unknown as LiveSnapshotStore;
}

function makeFixture(id: number): LiveFixture {
    return {id};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flushPromises(): Promise<void> {
    // Drains the micro-task queue so async continuations inside the poller
    // can settle after timers have fired. Multiple awaits are needed because
    // the poller's tick chain has several async boundaries (provider, client,
    // store writes, onTickFinished, finally-block reschedule).
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

describe("FixturePoller", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // start() / stop() lifecycle
    // -----------------------------------------------------------------------

    describe("start() / stop()", () => {
        it("is idempotent — calling start() twice does not schedule two loops", async () => {
            const provider = makeProvider([1]);
            const client = makeClient([makeFixture(1)]);
            const store = makeStore();
            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 1000,
                batchSize: 10,
            });

            poller.start();
            poller.start(); // second call should be a no-op

            await vi.advanceTimersByTimeAsync(1000);
            await flushPromises();

            // If two loops were running, getMulti would have been called twice.
            expect(vi.mocked(client.getMulti)).toHaveBeenCalledTimes(1);

            await poller.stop();
        });

        it("stop() before start() resolves immediately without error", async () => {
            const poller = new FixturePoller(makeClient(), makeProvider(), makeStore(), {
                intervalMs: 1000,
                batchSize: 10,
            });
            await expect(poller.stop()).resolves.toBeUndefined();
        });

        it("stop() prevents further ticks from running", async () => {
            const provider = makeProvider([1]);
            const client = makeClient([makeFixture(1)]);
            const store = makeStore();
            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 500,
                batchSize: 10,
            });

            poller.start();

            // Fire the first tick
            await vi.advanceTimersByTimeAsync(500);
            await flushPromises();

            const callsAfterFirst = vi.mocked(client.getMulti).mock.calls.length;
            expect(callsAfterFirst).toBe(1);

            await poller.stop();

            // Attempt to advance into what would have been a second tick
            await vi.advanceTimersByTimeAsync(1000);
            await flushPromises();

            expect(vi.mocked(client.getMulti)).toHaveBeenCalledTimes(callsAfterFirst);
        });
    });

    // -----------------------------------------------------------------------
    // Empty active set path
    // -----------------------------------------------------------------------

    describe("tick — empty active set", () => {
        it("calls evictMissing([]) but does NOT call the client", async () => {
            const provider = makeProvider([]); // no active fixtures
            const client = makeClient();
            const store = makeStore();
            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 100,
                batchSize: 10,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(store.evictMissing)).toHaveBeenCalledWith([]);
            expect(vi.mocked(client.getMulti)).not.toHaveBeenCalled();

            await poller.stop();
        });

        it("sets sportmonksActiveFixtureIds gauge to 0", async () => {
            const poller = new FixturePoller(makeClient(), makeProvider([]), makeStore(), {
                intervalMs: 100,
                batchSize: 10,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(sportmonksActiveFixtureIds.set)).toHaveBeenCalledWith(0);

            await poller.stop();
        });

        it("updates the last-success timestamp even when the active set is empty", async () => {
            const poller = new FixturePoller(makeClient(), makeProvider([]), makeStore(), {
                intervalMs: 100,
                batchSize: 10,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(sportmonksPollerLastSuccessTimestamp.set)).toHaveBeenCalled();

            await poller.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Normal tick — fixtures present
    // -----------------------------------------------------------------------

    describe("tick — fixtures present", () => {
        it("calls the client once when all IDs fit in a single batch", async () => {
            const ids = [1, 2, 3];
            const fixtures = ids.map(makeFixture);
            const provider = makeProvider(ids);
            const client = makeClient(fixtures);
            const store = makeStore();

            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 100,
                batchSize: 10, // all 3 fit
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(client.getMulti)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(client.getMulti)).toHaveBeenCalledWith(
                [1, 2, 3],
                expect.objectContaining({includes: expect.any(Array)}),
            );

            await poller.stop();
        });

        it("batches requests when IDs exceed batchSize", async () => {
            const ids = [1, 2, 3, 4, 5];
            const provider = makeProvider(ids);
            const client = makeClient(ids.map(makeFixture));
            const store = makeStore();

            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 100,
                batchSize: 2,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            // ids 5 → batches [1,2], [3,4], [5] = 3 calls
            expect(vi.mocked(client.getMulti)).toHaveBeenCalledTimes(3);

            await poller.stop();
        });

        it("calls replaceMany with all collected fixtures then evictMissing with active IDs", async () => {
            const ids = [10, 20];
            const fixtures = ids.map(makeFixture);
            const provider = makeProvider(ids);
            const client = makeClient(fixtures);
            const store = makeStore();

            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 100,
                batchSize: 10,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(store.replaceMany)).toHaveBeenCalledWith(fixtures);
            expect(vi.mocked(store.evictMissing)).toHaveBeenCalledWith(ids);

            await poller.stop();
        });

        it("updates gauge metrics after a successful tick", async () => {
            const ids = [1, 2];
            const poller = new FixturePoller(makeClient(ids.map(makeFixture)), makeProvider(ids), makeStore(), {
                intervalMs: 100,
                batchSize: 10,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(sportmonksActiveFixtureIds.set)).toHaveBeenCalledWith(2);
            expect(vi.mocked(sportmonksPollerLastSuccessTimestamp.set)).toHaveBeenCalled();

            await poller.stop();
        });

        it("requests the correct include blocks (scores, state, events, participants, statistics, periods)", async () => {
            const provider = makeProvider([1]);
            const client = makeClient([makeFixture(1)]);
            const store = makeStore();

            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 100,
                batchSize: 10,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(client.getMulti)).toHaveBeenCalledWith(
                expect.any(Array),
                {includes: expect.arrayContaining(["scores", "state", "events", "participants", "statistics", "periods"])},
            );

            await poller.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Error resilience
    // -----------------------------------------------------------------------

    describe("error handling", () => {
        it("continues polling after a tick where the API client throws", async () => {
            const provider = makeProvider([1]);
            const client = {
                getMulti: vi
                    .fn()
                    .mockRejectedValueOnce(new Error("API down"))
                    .mockResolvedValue([makeFixture(1)]),
            } as unknown as FixturesClient;
            const store = makeStore();

            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 100,
                batchSize: 10,
            });

            poller.start();

            // First tick — fails
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            // Second tick — succeeds
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(client.getMulti)).toHaveBeenCalledTimes(2);

            await poller.stop();
        });

        it("catches and isolates exceptions thrown by onTickFinished", async () => {
            // Use a non-empty provider so runTick does not return early before
            // reaching the onTickFinished call.
            const provider = makeProvider([1]);
            const client = makeClient([makeFixture(1)]);
            const store = makeStore();
            const onTickFinished = vi.fn().mockRejectedValue(new Error("hook error"));

            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 100,
                batchSize: 10,
                onTickFinished,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            // The loop should still be alive — advance into a second tick
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(onTickFinished).toHaveBeenCalledTimes(2);

            await poller.stop();
        });
    });

    // -----------------------------------------------------------------------
    // onTickFinished hook
    // -----------------------------------------------------------------------

    describe("onTickFinished hook", () => {
        it("is invoked after each successful tick", async () => {
            const onTickFinished = vi.fn().mockResolvedValue(undefined);
            // Use a non-empty provider so runTick does not return early before
            // reaching the onTickFinished call (the early return in the empty
            // active-set branch skips onTickFinished by design).
            const poller = new FixturePoller(
                makeClient([makeFixture(1)]),
                makeProvider([1]),
                makeStore(),
                {intervalMs: 100, batchSize: 10, onTickFinished},
            );

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(onTickFinished).toHaveBeenCalledTimes(1);

            await poller.stop();
        });

        it("is still invoked even when the tick throws", async () => {
            const client = {
                getMulti: vi.fn().mockRejectedValue(new Error("API error")),
            } as unknown as FixturesClient;
            const onTickFinished = vi.fn().mockResolvedValue(undefined);

            const poller = new FixturePoller(client, makeProvider([1]), makeStore(), {
                intervalMs: 100,
                batchSize: 10,
                onTickFinished,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(onTickFinished).toHaveBeenCalledTimes(1);

            await poller.stop();
        });

        it("is not required — poller runs fine without the hook", async () => {
            const store = makeStore();
            const poller = new FixturePoller(makeClient(), makeProvider([]), store, {
                intervalMs: 100,
                batchSize: 10,
                // no onTickFinished
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(store.evictMissing)).toHaveBeenCalled();

            await poller.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Chunking helper (indirectly via batching behaviour)
    // -----------------------------------------------------------------------

    describe("batch size edge cases", () => {
        it("sends all IDs in one call when batchSize equals the number of IDs", async () => {
            const ids = [1, 2, 3];
            const provider = makeProvider(ids);
            const client = makeClient(ids.map(makeFixture));
            const store = makeStore();

            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 100,
                batchSize: 3,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(client.getMulti)).toHaveBeenCalledTimes(1);

            await poller.stop();
        });

        it("handles batchSize of 1 by making one call per fixture", async () => {
            const ids = [1, 2, 3];
            const provider = makeProvider(ids);
            const client = makeClient([makeFixture(1)]);
            const store = makeStore();

            const poller = new FixturePoller(client, provider, store, {
                intervalMs: 100,
                batchSize: 1,
            });

            poller.start();
            await vi.advanceTimersByTimeAsync(100);
            await flushPromises();

            expect(vi.mocked(client.getMulti)).toHaveBeenCalledTimes(3);

            await poller.stop();
        });
    });
});
