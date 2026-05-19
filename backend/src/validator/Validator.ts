// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface Validator<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validate(object: unknown, params?: ValidatorParams<any>): ValidatorError | null;
}

export interface ValidatorError {
    property: string | null;
    error: string;
    children: ValidatorError[];
}

export interface ValidatorParams<T> {
    key: keyof T;
    obj: T;
}
