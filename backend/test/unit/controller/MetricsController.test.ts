/**
 * Unit tests for MetricsController.
 *
 * The `register` object imported from `../sportmonks/metrics` is mocked at
 * the module level so no actual Prometheus registry is touched in tests.
 */
import {beforeEach, describe, expect, it, vi} from "vitest";

import {MetricsController} from "../../../src/controller/MetricsController";

vi.mock("../../../src/sportmonks/metrics", () => ({
    register: {
        metrics: vi.fn(),
        contentType: "text/plain; version=0.0.4; charset=utf-8",
    },
}));

// Import AFTER mock registration so the mock is in place.
import {register} from "../../../src/sportmonks/metrics";

describe("MetricsController.handle", () => {
    const controller = new MetricsController();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns a RawResponse with the correct body and content type", async () => {
        vi.mocked(register.metrics).mockResolvedValue("# HELP ...\n# TYPE ...\n");

        const result = await controller.handle(undefined as void);

        expect(result).toMatchObject({
            body: "# HELP ...\n# TYPE ...\n",
            contentType: "text/plain; version=0.0.4; charset=utf-8",
        });
    });

    it("throws a ServiceError when the registry throws", async () => {
        vi.mocked(register.metrics).mockRejectedValue(new Error("registry error"));

        await expect(controller.handle(undefined as void)).rejects.toMatchObject({
            name: "ServiceError",
            message: "Failed to render metrics",
        });
    });

    it("still throws a ServiceError when the registry throws a non-Error", async () => {
        vi.mocked(register.metrics).mockRejectedValue("string error");

        await expect(controller.handle(undefined as void)).rejects.toMatchObject({
            name: "ServiceError",
        });
    });
});
