import * as _ from "lodash";
import {Validator, ValidatorError} from "./Validator";

export class BooleanValidator implements Validator<boolean> {
    validate(object: boolean): ValidatorError | null {
        if (_.isBoolean(object)) {
            return null;
        }

        return {
            property: null,
            error: "is not boolean",
            children: [],
        }
    }
}
