import React, {type ReactElement, type ReactNode} from "react";
import {render, type RenderOptions, type RenderResult} from "@testing-library/react";
import {
    Refine,
    type AccessControlProvider,
    type AuthProvider,
    type DataProvider,
} from "@refinedev/core";
import routerBindings from "@refinedev/react-router-v6";
import dataProvider from "@refinedev/simple-rest";
import {MemoryRouter} from "react-router-dom";

/**
 * Renders a component inside the providers it expects to find at runtime:
 * `<MemoryRouter>` + `<Refine>` with stubbed auth/data/accessControl providers.
 *
 * Pass `initialEntries` to seed the router. Pass any provider override to swap
 * the default stub (the defaults are permissive — `authProvider.check` returns
 * `authenticated: true`, `accessControlProvider.can` returns `true`, and the
 * `dataProvider` points at a non-existent URL so any accidental network call
 * fails loud rather than silently flakes).
 *
 * Standard Testing Library options (`container`, `wrapper`, …) pass through
 * via `renderOptions`.
 */
export interface RenderWithProvidersOptions {
    initialEntries?: string[];
    authProvider?: Partial<AuthProvider>;
    accessControlProvider?: AccessControlProvider;
    dataProvider?: DataProvider;
    renderOptions?: Omit<RenderOptions, "wrapper">;
}

const defaultAuthProvider: AuthProvider = {
    login: async () => ({success: true}),
    logout: async () => ({success: true}),
    check: async () => ({authenticated: true}),
    onError: async () => ({}),
    getPermissions: async () => [],
    getIdentity: async () => ({id: 1, name: "Test User"}),
};

const defaultAccessControlProvider: AccessControlProvider = {
    can: async () => ({can: true}),
};

const defaultDataProvider: DataProvider = dataProvider("http://test.invalid");

export function renderWithProviders(
    ui: ReactElement,
    {
        initialEntries = ["/"],
        authProvider,
        accessControlProvider,
        dataProvider: dataProviderOverride,
        renderOptions,
    }: RenderWithProvidersOptions = {},
): RenderResult {
    const wrapper = ({children}: {children: ReactNode}) => (
        <MemoryRouter initialEntries={initialEntries}>
            <Refine
                authProvider={{...defaultAuthProvider, ...authProvider}}
                accessControlProvider={accessControlProvider ?? defaultAccessControlProvider}
                dataProvider={dataProviderOverride ?? defaultDataProvider}
                routerProvider={routerBindings}
            >
                {children}
            </Refine>
        </MemoryRouter>
    );

    return render(ui, {wrapper, ...renderOptions});
}
