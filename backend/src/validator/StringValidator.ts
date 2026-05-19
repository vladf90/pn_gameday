import * as _ from "lodash";
import {Validator, ValidatorError} from "./Validator";

export class StringValidator implements Validator<string> {
    validate(object: string): ValidatorError | null {
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
