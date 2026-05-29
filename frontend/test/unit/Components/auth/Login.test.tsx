/**
 * Exemplar React Testing Library component test (issue #89, ADR 0009).
 *
 * What this exercises:
 *  - The real `<Login />` component (a thin wrapper around Refine's `AuthPage`).
 *  - The real `createAuthProvider`, which is the conduit between the form
 *    and the `AuthRequestClient`.
 *  - The boundary mock: `AuthRequestClient` is replaced module-wide with a
 *    spy via `vi.mock` so no HTTP happens. `vi.hoisted` keeps the spy
 *    addressable from the test body even though `vi.mock` is hoisted above
 *    the imports.
 *
 * What this deliberately does NOT do:
 *  - Assert on the exact DOM produced by Antd's `AuthPage` (third-party UI;
 *    queries go through accessible roles/labels so the test survives
 *    upstream restyles).
 *  - Assert on notification toasts (Antd's notifications live in a portal
 *    and are timing-sensitive; we use the absence of a stored auth token
 *    as the failure signal instead).
 *
 * Copy this file as the template for component tests that hit a request client.
 */
import React from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {loginMock} = vi.hoisted(() => ({loginMock: vi.fn()}));

vi.mock("../../../../src/clients/AuthRequestClient", () => ({
    AuthRequestClient: vi.fn().mockImplementation(() => ({login: loginMock})),
}));

import {Login} from "../../../../src/Components/auth/Login";
import {AuthRequestClient} from "../../../../src/clients/AuthRequestClient";
import {createAuthProvider} from "../../../../src/providers/AuthProvider";
import {renderWithProviders} from "../../../renderWithProviders";

describe("<Login>", () => {
    beforeEach(() => {
        loginMock.mockReset();
        localStorage.clear();
    });

    it("calls the auth client with the entered credentials on submit", async () => {
        loginMock.mockResolvedValueOnce({
            token: "fake-token",
            permissions: ["fixture:read"],
            firstName: "Alice",
            lastName: "Anderson",
        });
        const authProvider = createAuthProvider(new AuthRequestClient());
        const user = userEvent.setup();

        renderWithProviders(<Login />, {authProvider, initialEntries: ["/login"]});

        await user.type(screen.getByLabelText(/email/i), "alice@example.com");
        await user.type(screen.getByLabelText(/password/i), "hunter2");
        await user.click(screen.getByRole("button", {name: /sign in/i}));

        await waitFor(() => {
            expect(loginMock).toHaveBeenCalledWith({
                username: "alice@example.com",
                password: "hunter2",
            });
        });
        // Successful login writes the token to localStorage (see AuthProvider.login).
        await waitFor(() => expect(localStorage.getItem("token")).toBe("fake-token"));
    });

    it("leaves the user on the login form when the auth client rejects", async () => {
        loginMock.mockRejectedValueOnce(new Error("network down"));
        const authProvider = createAuthProvider(new AuthRequestClient());
        const user = userEvent.setup();

        renderWithProviders(<Login />, {authProvider, initialEntries: ["/login"]});

        await user.type(screen.getByLabelText(/email/i), "alice@example.com");
        await user.type(screen.getByLabelText(/password/i), "wrong");
        await user.click(screen.getByRole("button", {name: /sign in/i}));

        await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1));
        // No token persisted, login form still visible — no redirect happened.
        expect(localStorage.getItem("token")).toBeNull();
        expect(screen.getByRole("button", {name: /sign in/i})).toBeInTheDocument();
    });
});
