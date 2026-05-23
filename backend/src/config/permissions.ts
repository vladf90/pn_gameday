export interface Permission {
    resource: string;
    action: 'create' | 'read' | 'update' | 'delete' | '*';
}

export interface RoleDefinition {
    name: string;
    description: string;
    permissions: Permission[];
}

export const ROLES: Record<string, RoleDefinition> = {
    admin: {
        name: 'Admin',
        description: 'Full system access',
        permissions: [
            { resource: '*', action: '*' }
        ]
    },
    user: {
        name: 'User',
        description: 'Default authenticated user',
        permissions: [
            { resource: 'session', action: 'read' },
            { resource: 'session', action: 'create' },
            { resource: 'session', action: 'update' },
            { resource: 'session', action: 'delete' },
            { resource: 'fixture', action: 'read' }
        ]
    }
};

/**
 * Get permissions for a role
 */
export function getPermissionsForRole(role: string): Permission[] {
    const roleDefinition = ROLES[role];
    if (!roleDefinition) {
        return [];
    }
    return roleDefinition.permissions;
}

/**
 * Format permissions as strings (e.g., "resource:create")
 */
export function getPermissionStrings(role: string): string[] {
    const permissions = getPermissionsForRole(role);
    return permissions.map(p => `${p.resource}:${p.action}`);
}

/**
 * Check if user has specific permission
 */
export function hasPermission(
    permissions: string[],
    resource: string,
    action: string
): boolean {
    if (permissions.includes('*:*')) {
        return true;
    }
    if (permissions.includes(`${resource}:*`)) {
        return true;
    }
    return permissions.includes(`${resource}:${action}`);
}
