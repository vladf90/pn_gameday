import { Context } from "../Logger/Context";
import { FixturesClient, FixtureByDate } from "../sportmonks";
import { ObjectValidator } from "../validator/ObjectValidator";
import { Validator, ValidatorError } from "../validator/Validator";

/**
 * Public day-view endpoint. Proxies SportMonks `/fixtures/date/{date}` with
 * the minimum includes needed to render kickoff time, teams, league, and
 * live/final score. Registered on `NoAuthRouter` — see ADR 0003.
 */
export class FixtureController {

    constructor(private readonly fixturesClient: FixturesClient) {}

    getByDate = async (
        ctx: Context,
        _auth: void,
        request: GetFixturesByDateRequest,
    ): Promise<FixtureByDate[]> => {
        return this.fixturesClient.getByDate<FixtureByDate>(request.date, {
            includes: ["participants", "league", "scores", "state"],
            ctx,
        });
    };
}

export interface GetFixturesByDateRequest {
    date: string;
}

/**
 * Strict `YYYY-MM-DD` check — narrower than the general `DateValidator`,
 * which accepts any ISO 8601 string. SportMonks's date path segment is
 * format-sensitive, so we reject anything other than a calendar date here.
 */
class IsoDateOnlyValidator implements Validator<string> {

    private static readonly PATTERN = /^\d{4}-\d{2}-\d{2}$/;

    validate(object: unknown): ValidatorError | null {
        if (typeof object !== "string" || !IsoDateOnlyValidator.PATTERN.test(object) || Number.isNaN(Date.parse(object))) {
            return {
                property: null,
                error: "is not a valid YYYY-MM-DD date",
                children: [],
            };
        }
        return null;
    }
}

export class GetFixturesByDateValidator extends ObjectValidator<GetFixturesByDateRequest> {
    constructor() {
        super();
        this.add("date", new IsoDateOnlyValidator());
    }
}
