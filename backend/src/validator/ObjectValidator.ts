import * as _ from "lodash";
import {Validator, ValidatorError, ValidatorParams} from "./Validator";

export class ObjectValidator<T> implements Validator<T> {
    private properyMapValidators: Map<keyof T, Validator<T[keyof T]>>;

    constructor() {
        this.properyMapValidators = new Map<keyof T, Validator<T[keyof T]>>();
    }

    public add<K extends keyof T>(key: K, validator: Validator<T[K]>) {
        this.properyMapValidators.set(key, validator);
    }

    public validate(object: unknown): ValidatorError | null {
        if (!this.isObject(object)) {
            return {
                property: null,
                error: "Is not object",
                children: []
            }
        }

        const validatorsErrors = this.validatePlainObject(object);
        if (validatorsErrors.length === 0) {
            return null;
        }

        return {
            property: null,
            error: "Validation Error",
            children: validatorsErrors
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isObject(object: any): object is {[key: string]: any} {
        return _.isPlainObject(object);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private validatePlainObject(object: {[key: string]: any}): ValidatorError[] {
        const errors: ValidatorError[] = [];
        for (const [key, validator] of this.properyMapValidators.entries()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const params: ValidatorParams<{ [key: string]: any }> = {
                key: key as string,
                obj: object
            }
            const error = validator.validate(object[key as string], params);
            if (error) {
                error.property = key as string;
                errors.push(error);
            }
        }
        return errors;
    }
}
