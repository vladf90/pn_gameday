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
                        <Route index element={<FixturesByDate />} />
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
                            <Route path="/home" element={<Home />} />
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
