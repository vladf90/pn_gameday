import React from "react";
import { Refine, Authenticated } from "@refinedev/core";
import { ConfigProvider } from "antd";
import routerBindings, {
    DocumentTitleHandler,
    UnsavedChangesNotifier,
} from "@refinedev/react-router-v6";
import { BrowserRouter, Route, Routes, Outlet, Navigate } from "react-router-dom";

import { createAuthProvider } from "./providers/AuthProvider";
import { createAccessControlProvider } from "./providers/AccessControlProvider";
import { AuthRequestClient } from "./clients/AuthRequestClient";
import { Login } from "./Components/auth/Login";
import { Home } from "./Components/home/Home";
import { FixturesByDate } from "./Components/fixtures/FixturesByDate";
import { SessionsList } from "./Components/sessions/SessionsList";
import { SessionDetail } from "./Components/sessions/SessionDetail";
import { OverlayPage } from "./Components/overlay/OverlayPage";

const authRequestClient = new AuthRequestClient();
const authProvider = createAuthProvider(authRequestClient);
const accessControlProvider = createAccessControlProvider();

const App: React.FC = () => {
    return (
        <BrowserRouter>
            <ConfigProvider>
                <Refine
                    authProvider={authProvider}
                    accessControlProvider={accessControlProvider}
                    routerProvider={routerBindings}
                    resources={[]}
                    options={{
                        syncWithLocation: true,
                        warnWhenUnsavedChanges: true,
                    }}
                >
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        {/*
                         * Public overlay (ADR 0005 §4). Sits OUTSIDE the
                         * `<Authenticated>` block — OBS Browser Source has no
                         * way to present a JWT, and the URL itself is the
                         * capability. The OverlayPage also sets a transparent
                         * body background so OBS can composite it cleanly.
                         */}
                        <Route path="/overlay/:sessionId" element={<OverlayPage />} />
                        <Route
                            element={
                                <Authenticated
                                    key="authenticated-layout"
                                    fallback={<Navigate to="/login" replace />}
                                >
                                    <Outlet />
                                </Authenticated>
                            }
                        >
                            <Route index element={<FixturesByDate />} />
                            <Route path="/home" element={<Home />} />
                            <Route path="/sessions" element={<SessionsList />} />
                            <Route path="/sessions/:id" element={<SessionDetail />} />
                        </Route>
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                    <UnsavedChangesNotifier />
                    <DocumentTitleHandler />
                </Refine>
            </ConfigProvider>
        </BrowserRouter>
    );
};

export default App;
