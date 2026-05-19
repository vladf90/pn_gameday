import {Validator, ValidatorError, ValidatorParams} from "./Validator";

export class NumberValidator implements Validator<number> {

    public constructor(
        private readonly allowUndefined: boolean = false,
        private readonly convertToNumber: boolean = true) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validate(object: number, params?: ValidatorParams<any>): ValidatorError | null {
        if (this.allowUndefined && (object === undefined || object === null)) {
            return null;
        }

        if (!isNaN(Number(object))) {
            if (this.convertToNumber) {
                params.obj[params.key] = Number(object);
            }
            return null;
        }

        return {
            error: "is not number",
            children: [],
            property: null
        }
    }
}
