import {SessionFixtureRepository} from "../database/repositories/SessionFixtureRepository";
import {FixtureSelectionProvider} from "./FixtureSelectionProvider";

/**
 * Default `FixtureSelectionProvider` — the set of fixtures the poller
 * tracks is the deduped union of `sportmonks_fixture_id` across every
 * session in Postgres.
 *
 * The repository already deduplicates via `DISTINCT`; we additionally sort
 * ascending here so callers (and tests) get a stable order regardless of
 * how Postgres happens to lay out the underlying rows.
 */
export class SessionFixtureProvider implements FixtureSelectionProvider {

    constructor(private readonly repo: SessionFixtureRepository) {}

    async getActiveFixtureIds(): Promise<number[]> {
        const ids = await this.repo.findAllSportmonksFixtureIds();
        // Defensive dedupe: the repository already uses `DISTINCT`, but
        // protecting the contract here means a future repo refactor cannot
        // silently break downstream consumers.
        const deduped = Array.from(new Set(ids));
        deduped.sort((a, b) => a - b);
        return deduped;
    }
}
