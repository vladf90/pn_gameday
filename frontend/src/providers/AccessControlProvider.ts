import { AccessControlProvider } from "@refinedev/core";
import { canAccessResource } from "../common/permissions";

export const createAccessControlProvider = (): AccessControlProvider => {
    return {
        can: async ({ resource }) => {
            const token = localStorage.getItem('token');
            if (!token) {
                return { can: false };
            }

            const permissionsStr = localStorage.getItem('permissions');
            let permissions: string[] = [];

            if (permissionsStr) {
                try {
                    permissions = JSON.parse(permissionsStr);
                } catch {
                    permissions = [];
                }
            }

            // If no permissions but has token, allow access
            if (permissions.length === 0) {
                return { can: true };
            }

            if (resource) {
                // Map Refine resource name → backend permission resource name.
                // Add entries here as you introduce new resources.
                const resourcePermissions: Record<string, string[]> = {};

                const permResources = resourcePermissions[resource];

                // Unknown resource — allow by default during skeleton phase; tighten later.
                if (!permResources) {
                    return { can: true };
                }

                return {
                    can: permResources.some((r) => canAccessResource(permissions, r)),
                };
            }

            return { can: true };
        },
    };
};
