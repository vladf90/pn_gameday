import * as _ from "lodash";
import {Validator, ValidatorError} from "./Validator";

export class StringValidator implements Validator<string> {

    public constructor(private readonly allowUndefined: boolean = false) {}

    validate(object: string): ValidatorError | null {
        if (this.allowUndefined && (object === undefined || object === null)) {
            return null;
        }

        if (_.isString(object)) {
            return null;
        }

        return {
            property: null,
            error: "is not string",
            children: [],
        }
    }
}
