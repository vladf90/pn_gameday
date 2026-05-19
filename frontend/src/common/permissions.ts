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
    if (action !== '*' && permissions.includes(`${resource}:${action}`)) {
        return true;
    }
    return false;
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
