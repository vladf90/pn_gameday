/**
 * Check if user has specific permission.
 * @param permissions - Array of permission strings from auth
 * @param resource - Resource name (e.g., 'user')
 * @param action - Action type ('create' | 'read' | 'update' | 'delete') or '*' for any
 */
export function hasPermission(
    permissions: string[] | null | undefined,
    resource: string,
    action: string = '*'
): boolean {
    if (!permissions || permissions.length === 0) {
        return false;
    }
    if (permissions.includes('*:*')) {
        return true;
    }
    if (permissions.includes(`${resource}:*`)) {
        return true;
    }
    if (action === '*') {
        // "Any action on this resource" — grant if at least one permission
        // of the form `${resource}:<something>` exists. Without this branch
        // `canAccessResource(["user:read"], "user")` would wrongly return
        // false even though the caller clearly has a permission on `user`.
        return permissions.some((p) => p.startsWith(`${resource}:`));
    }
    return permissions.includes(`${resource}:${action}`);
}

/**
 * Check if user can access a resource (any action).
 */
export function canAccessResource(
    permissions: string[] | null | undefined,
    resource: string
): boolean {
    return hasPermission(permissions, resource, '*');
}
