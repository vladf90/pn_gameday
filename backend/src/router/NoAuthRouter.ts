import {BaseRouter} from "./BaseRouter";

export class NoAuthRouter extends BaseRouter<void> {
    authenticate(): Promise<void> {
        return Promise.resolve();
    }
}
