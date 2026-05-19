import * as moment from "moment";
import {Validator, ValidatorError, ValidatorParams} from "./Validator";

export class DateValidator implements Validator<Date> {
    constructor(private readonly convertToDate: boolean) {
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validate(object: string, params?: ValidatorParams<any>): ValidatorError | null {
        if (moment(object, moment.ISO_8601).isValid()) {
            if (this.convertToDate && params && params.obj) {
                params.obj[params.key] = new Date(object);
            }
            return null;
        }

        return {
            property: null,
            error: "is not a date",
            children: [],
        }
    }
}
