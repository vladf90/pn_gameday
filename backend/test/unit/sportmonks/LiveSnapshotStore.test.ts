import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../../src/sportmonks/metrics", () => ({
    sportmonksLiveFixturesInMemory: {set: vi.fn()},
}));

import {LiveSnapshotStore} from "../../../src/sportmonks/LiveSnapshotStore";
import {sportmonksLiveFixturesInMemory} from "../../../src/sportmonks/metrics";
import type {LiveFixture} from "../../../src/sportmonks/types";

function makeFixture(id: number): LiveFixture {
    return {id};
}

describe("LiveSnapshotStore", () => {
    let store: LiveSnapshotStore;

    beforeEach(() => {
        vi.clearAllMocks();
        store = new LiveSnapshotStore();
    });

    describe("get()", () => {
        it("returns undefined for an absent fixture", () => {
            expect(store.get(999)).toBeUndefined();
        });

        it("returns the fixture after it has been stored", () => {
            store.replaceMany([makeFixture(1)]);
            expect(store.get(1)).toEqual({id: 1});
        });
    });

    describe("getMany()", () => {
        it("returns an empty array when the store is empty", () => {
            expect(store.getMany([1, 2, 3])).toEqual([]);
        });

        it("returns only the fixtures that exist, preserving request order", () => {
            store.replaceMany([makeFixture(1), makeFixture(2), makeFixture(3)]);
            expect(store.getMany([3, 1])).toEqual([{id: 3}, {id: 1}]);
        });

        it("silently skips IDs not in the store", () => {
            store.replaceMany([makeFixture(1)]);
            expect(store.getMany([1, 999])).toEqual([{id: 1}]);
        });

        it("returns an empty array when none of the requested IDs are present", () => {
            store.replaceMany([makeFixture(1)]);
            expect(store.getMany([2, 3])).toEqual([]);
        });
    });

    describe("getAll()", () => {
        it("returns an empty array when the store is empty", () => {
            expect(store.getAll()).toEqual([]);
        });

        it("returns all fixtures in insertion order", () => {
            store.replaceMany([makeFixture(10), makeFixture(20)]);
            expect(store.getAll()).toEqual([{id: 10}, {id: 20}]);
        });
    });

    describe("replaceMany()", () => {
        it("inserts new entries", () => {
            store.replaceMany([makeFixture(1), makeFixture(2)]);
            expect(store.get(1)).toBeDefined();
            expect(store.get(2)).toBeDefined();
        });

        it("overwrites an existing entry when the same ID is re-inserted", () => {
            const original: LiveFixture = {id: 1, name: "Original"};
            const updated: LiveFixture = {id: 1, name: "Updated"};
            store.replaceMany([original]);
            store.replaceMany([updated]);
            expect(store.get(1)).toEqual(updated);
        });

        it("does NOT remove entries for IDs absent from the input", () => {
            store.replaceMany([makeFixture(1), makeFixture(2)]);
            store.replaceMany([makeFixture(3)]);
            // 1 and 2 must still be present
            expect(store.get(1)).toBeDefined();
            expect(store.get(2)).toBeDefined();
            expect(store.get(3)).toBeDefined();
        });

        it("updates the Prometheus gauge to the current store size", () => {
            store.replaceMany([makeFixture(1), makeFixture(2)]);
            expect(vi.mocked(sportmonksLiveFixturesInMemory.set)).toHaveBeenLastCalledWith(2);
        });
    });

    describe("evictMissing()", () => {
        it("removes entries whose IDs are not in the active set", () => {
            store.replaceMany([makeFixture(1), makeFixture(2), makeFixture(3)]);
            store.evictMissing([1, 3]);
            expect(store.get(2)).toBeUndefined();
            expect(store.get(1)).toBeDefined();
            expect(store.get(3)).toBeDefined();
        });

        it("removes all entries when called with an empty list", () => {
            store.replaceMany([makeFixture(1), makeFixture(2)]);
            store.evictMissing([]);
            expect(store.getAll()).toEqual([]);
        });

        it("is a no-op when the store is already empty", () => {
            expect(() => store.evictMissing([1, 2])).not.toThrow();
        });

        it("updates the Prometheus gauge after eviction", () => {
            store.replaceMany([makeFixture(1), makeFixture(2), makeFixture(3)]);
            vi.clearAllMocks();
            store.evictMissing([1]);
            expect(vi.mocked(sportmonksLiveFixturesInMemory.set)).toHaveBeenCalledWith(1);
        });
    });
});
