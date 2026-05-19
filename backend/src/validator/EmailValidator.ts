import {Validator, ValidatorError} from "./Validator";
import isEmail from "validator/lib/isEmail";

export class EmailValidator implements Validator<string> {
    validate(object: string): ValidatorError | null {
        if (isEmail(object)) {
            return null;
        }

        return {
            error: "is not email",
            children: [],
            property: null
        }
    }
}
