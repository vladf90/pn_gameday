/**
 * Generic envelope every SportMonks v3 endpoint wraps its payload in.
 *
 * Real responses also carry `pagination`, `subscription`, `meta`, and
 * `timezone` blocks; we only model the fields the client needs to operate.
 * Consumers receive the unwrapped `data` plus the parsed rate-limit block.
 */
export interface SportmonksRateLimitBlock {
    remaining: number;
    requested_entity: string;
    resets_in_seconds: number;
}

export interface SportmonksResponseEnvelope<T> {
    data: T;
    rate_limit?: SportmonksRateLimitBlock;
}
