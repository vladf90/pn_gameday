import { AuthProvider } from "@refinedev/core";
import { AuthRequestClient } from "../clients/AuthRequestClient";

export const createAuthProvider = (requestClient: AuthRequestClient): AuthProvider => ({
    login: async ({ email, password }) => {
        try {
            const response = await requestClient.login({ username: email, password });
            if (!response.token) {
                return {
                    success: false,
                    error: {
                        name: "LoginError",
                        message: "Invalid credentials",
                    },
                };
            }
            localStorage.setItem('token', response.token);
            localStorage.setItem('permissions', JSON.stringify(response.permissions || []));
            localStorage.setItem('firstName', response.firstName || '');
            localStorage.setItem('lastName', response.lastName || '');
            return {
                success: true,
                redirectTo: "/",
            };
        } catch {
            return {
                success: false,
                error: {
                    name: "LoginError",
                    message: "Login failed",
                },
            };
        }
    },

    logout: async () => {
        localStorage.removeItem('token');
        localStorage.removeItem('permissions');
        localStorage.removeItem('firstName');
        localStorage.removeItem('lastName');
        return {
            success: true,
            redirectTo: "/login",
        };
    },

    check: async () => {
        const token = localStorage.getItem('token');
        if (token) {
            return { authenticated: true };
        }
        return {
            authenticated: false,
            redirectTo: "/login",
        };
    },

    onError: async (error) => {
        const status = error?.status;
        if (status === 401 || status === 403) {
            localStorage.removeItem('token');
            return { logout: true };
        }
        return { logout: false };
    },

    getPermissions: async () => {
        const permissionsStr = localStorage.getItem('permissions');
        if (permissionsStr) {
            try {
                return JSON.parse(permissionsStr);
            } catch {
                return [];
            }
        }
        return [];
    },

    getIdentity: async () => {
        const token = localStorage.getItem('token');
        if (token) {
            const firstName = localStorage.getItem('firstName') || 'User';
            const lastName = localStorage.getItem('lastName') || '';
            return {
                id: 1,
                name: firstName,
                fullName: `${firstName} ${lastName}`.trim(),
                avatar: "",
            };
        }
        return null;
    },
});
