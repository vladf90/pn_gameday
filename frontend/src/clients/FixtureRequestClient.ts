import {RequestClient} from "./RequestClient";
import {FixtureModel} from "../common/fixtures";

export class FixtureRequestClient extends RequestClient {
    async getByDate(date: string): Promise<FixtureModel[]> {
        return await this.get<{date: string}, FixtureModel[]>("/fixtures", {date});
    }
}
