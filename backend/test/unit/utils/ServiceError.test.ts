import {describe, expect, it} from "vitest";

import {ServiceError} from "../../../src/utils/ServiceError";

describe("ServiceError", () => {
    describe("constructor + getters", () => {
        it("stores message, statusCode, and exposes them via getters", () => {
            const err = new ServiceError("Something went wrong", 422);
            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(ServiceError);
            expect(err.message).toBe("Something went wrong");
            expect(err.name).toBe("ServiceError");
            expect(err.getStatusCode()).toBe(422);
            expect(err.getInfo()).toBeUndefined();
        });

        it("stores optional info and returns it via getInfo()", () => {
            const info = {field: "name", detail: "too long"};
            const err = new ServiceError("Validation failed", 400, info);
            expect(err.getInfo()).toEqual(info);
        });
    });

    describe("ServiceError.build", () => {
        it("creates a ServiceError with the correct message and status code", () => {
            const err = ServiceError.build("Not found", 404);
            expect(err).toBeInstanceOf(ServiceError);
            expect(err.message).toBe("Not found");
            expect(err.getStatusCode()).toBe(404);
            expect(err.getInfo()).toBeUndefined();
        });

        it("forwards optional info when provided", () => {
            const info = {errors: ["field required"]};
            const err = ServiceError.build("Bad request", 400, info);
            expect(err.getInfo()).toEqual(info);
        });

        it("returns a ServiceError that can be thrown and caught", () => {
            const err = ServiceError.build("Conflict", 409);
            let caught: unknown;
            try {
                throw err;
            } catch (e) {
                caught = e;
            }
            expect(caught).toBe(err);
            expect((caught as ServiceError).getStatusCode()).toBe(409);
        });
    });

    describe("inheritance", () => {
        it("is an instanceof Error", () => {
            expect(ServiceError.build("x", 500)).toBeInstanceOf(Error);
        });

        it("preserves name across build()", () => {
            expect(ServiceError.build("x", 500).name).toBe("ServiceError");
        });
    });
});
