/**
 * Lightweight test data factories.
 *
 * Each factory returns a plain-object attribute bag rather than a persisted
 * entity — call sites decide whether to insert via a repository, the raw
 * EntityManager, or just use the attrs as expectations.
 *
 * Keep these factories deliberately small. If a factory grows past "default
 * values plus a Partial<T> override", that's a sign it's drifting toward a
 * test-only ORM and you should reach for the real repository instead.
 */

export interface UserAttrs {
    username: string;
    password: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
}

let userCounter = 0;

/**
 * Generates a unique user attribute bag suitable for `UserRepository.insertUser(...)`.
 * Pass overrides to pin specific fields.
 */
export function makeUserAttrs(overrides: Partial<UserAttrs> = {}): UserAttrs {
    const n = ++userCounter;
    return {
        username: `user_${n}`,
        password: `hashed-pw-${n}`,
        firstName: "Test",
        lastName: `User${n}`,
        email: `user_${n}@example.test`,
        role: "user",
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Session factories
// ---------------------------------------------------------------------------

export interface SessionAttrs {
    /** Owner user id — must be a real user row when used in integration tests. */
    userId: number;
    name: string;
    /** Hex overlay token. Defaults to a deterministic 64-char string. */
    overlayToken: string;
    endedAt: Date | null;
}

let sessionCounter = 0;

/**
 * Generates a unique session attribute bag.
 * Pass `overrides` to pin specific fields (e.g. `userId`, `endedAt`).
 */
export function makeSessionAttrs(overrides: Partial<SessionAttrs> = {}): SessionAttrs {
    const n = ++sessionCounter;
    return {
        userId: 1,
        name: `Session ${n}`,
        overlayToken: "ab".repeat(32).slice(0, 64),
        endedAt: null,
        ...overrides,
    };
}
