/**
 * Unit tests for all custom validator classes:
 * ObjectValidator, StringValidator, NumberValidator,
 * BooleanValidator, DateValidator, EmailValidator.
 *
 * Each test runs the validator directly — no I/O or mocking needed.
 *
 * Note on DateValidator: it is intentionally NOT covered here. DateValidator
 * does `import * as moment from "moment"` and calls the namespace as a factory
 * (`moment(str, moment.ISO_8601)`). This only works because the project emits
 * CommonJS (no esModuleInterop), so the namespace resolves to the callable
 * `require("moment")` — the same idiom used across the codebase (express, cors,
 * lodash, …). Under Vitest's ESM transform a namespace import is, per spec, a
 * non-callable object, and a `vi.mock` factory must return an object (not a
 * function), so the call site cannot be made callable without either rewriting
 * the source idiom or shimming moment's ISO parsing (which can't be replicated
 * faithfully). DateValidator's parsing is exercised end-to-end via the
 * integration tests' real CommonJS import chain instead.
 */
import {describe, expect, it} from "vitest";


import {ObjectValidator} from "../../../src/validator/ObjectValidator";
import {StringValidator} from "../../../src/validator/StringValidator";
import {NumberValidator} from "../../../src/validator/NumberValidator";
import {BooleanValidator} from "../../../src/validator/BooleanValidator";
import {EmailValidator} from "../../../src/validator/EmailValidator";

// ---------------------------------------------------------------------------
// StringValidator
// ---------------------------------------------------------------------------
describe("StringValidator", () => {
    describe("required (default, allowUndefined=false)", () => {
        const v = new StringValidator();

        it("returns null for a valid string", () => {
            expect(v.validate("hello")).toBeNull();
        });

        it("returns null for an empty string", () => {
            expect(v.validate("")).toBeNull();
        });

        it("errors on undefined", () => {
            expect(v.validate(undefined as unknown as string)).not.toBeNull();
            expect(v.validate(undefined as unknown as string)?.error).toBe("is not string");
        });

        it("errors on null", () => {
            expect(v.validate(null as unknown as string)).not.toBeNull();
        });

        it("errors on number", () => {
            expect(v.validate(42 as unknown as string)).not.toBeNull();
        });

        it("errors on boolean", () => {
            expect(v.validate(true as unknown as string)).not.toBeNull();
        });

        it("errors on object", () => {
            expect(v.validate({} as unknown as string)).not.toBeNull();
        });
    });

    describe("optional (allowUndefined=true)", () => {
        const v = new StringValidator(true);

        it("returns null for undefined", () => {
            expect(v.validate(undefined as unknown as string)).toBeNull();
        });

        it("returns null for null", () => {
            expect(v.validate(null as unknown as string)).toBeNull();
        });

        it("returns null for a valid string", () => {
            expect(v.validate("text")).toBeNull();
        });

        it("still errors on a non-string non-nullish value", () => {
            expect(v.validate(123 as unknown as string)).not.toBeNull();
        });
    });
});

// ---------------------------------------------------------------------------
// NumberValidator
// ---------------------------------------------------------------------------
describe("NumberValidator", () => {
    describe("required, convertToNumber=true (defaults)", () => {
        const v = new NumberValidator();

        it("returns null for a valid number", () => {
            const obj = {n: 5};
            expect(v.validate(5, {key: "n", obj})).toBeNull();
            expect(obj.n).toBe(5);
        });

        it("coerces a numeric string and mutates obj in place", () => {
            const obj: Record<string, unknown> = {n: "42"};
            expect(v.validate("42" as unknown as number, {key: "n" as keyof typeof obj, obj})).toBeNull();
            expect(obj["n"]).toBe(42);
        });

        it("coerces '0' to 0", () => {
            const obj: Record<string, unknown> = {n: "0"};
            v.validate("0" as unknown as number, {key: "n" as keyof typeof obj, obj});
            expect(obj["n"]).toBe(0);
        });

        it("errors on non-numeric string", () => {
            const obj: Record<string, unknown> = {n: "abc"};
            const result = v.validate("abc" as unknown as number, {key: "n" as keyof typeof obj, obj});
            expect(result).not.toBeNull();
            expect(result?.error).toBe("is not number");
        });

        it("errors on undefined when not optional", () => {
            const obj: Record<string, unknown> = {n: undefined};
            expect(v.validate(undefined as unknown as number, {key: "n" as keyof typeof obj, obj})).not.toBeNull();
        });

        it("coerces null to 0 (Number(null) === 0)", () => {
            // Number(null) === 0, which is not NaN, so the validator accepts it.
            // This is the actual behaviour — document it rather than fight it.
            const obj: Record<string, unknown> = {n: null};
            const result = v.validate(null as unknown as number, {key: "n" as keyof typeof obj, obj});
            expect(result).toBeNull();
            expect(obj["n"]).toBe(0);
        });
    });

    describe("optional (allowUndefined=true)", () => {
        const v = new NumberValidator(true);

        it("returns null for undefined", () => {
            expect(v.validate(undefined as unknown as number)).toBeNull();
        });

        it("returns null for null", () => {
            expect(v.validate(null as unknown as number)).toBeNull();
        });

        it("still validates a present number", () => {
            const obj: Record<string, unknown> = {n: "7"};
            expect(v.validate("7" as unknown as number, {key: "n" as keyof typeof obj, obj})).toBeNull();
        });
    });

    describe("convertToNumber=false", () => {
        const v = new NumberValidator(false, false);

        it("returns null without mutating params for a numeric string", () => {
            const obj: Record<string, unknown> = {n: "10"};
            const result = v.validate("10" as unknown as number, {key: "n" as keyof typeof obj, obj});
            expect(result).toBeNull();
            // obj must NOT have been converted
            expect(obj["n"]).toBe("10");
        });
    });
});

// ---------------------------------------------------------------------------
// BooleanValidator
// ---------------------------------------------------------------------------
describe("BooleanValidator", () => {
    const v = new BooleanValidator();

    it("returns null for true", () => {
        expect(v.validate(true)).toBeNull();
    });

    it("returns null for false", () => {
        expect(v.validate(false)).toBeNull();
    });

    it("errors on 'true' string", () => {
        expect(v.validate("true" as unknown as boolean)).not.toBeNull();
        expect(v.validate("true" as unknown as boolean)?.error).toBe("is not boolean");
    });

    it("errors on 1", () => {
        expect(v.validate(1 as unknown as boolean)).not.toBeNull();
    });

    it("errors on 0", () => {
        expect(v.validate(0 as unknown as boolean)).not.toBeNull();
    });

    it("errors on null", () => {
        expect(v.validate(null as unknown as boolean)).not.toBeNull();
    });

    it("errors on undefined", () => {
        expect(v.validate(undefined as unknown as boolean)).not.toBeNull();
    });

    it("errors on object", () => {
        expect(v.validate({} as unknown as boolean)).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// DateValidator — intentionally omitted; see the moment note in the file header.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// EmailValidator
// ---------------------------------------------------------------------------
describe("EmailValidator", () => {
    const v = new EmailValidator();

    it("returns null for a valid email", () => {
        expect(v.validate("alice@example.com")).toBeNull();
    });

    it("returns null for email with subdomain", () => {
        expect(v.validate("user@mail.example.co.uk")).toBeNull();
    });

    it("errors on plain string without @", () => {
        const result = v.validate("notanemail");
        expect(result).not.toBeNull();
        expect(result?.error).toBe("is not email");
    });

    it("errors on missing domain", () => {
        expect(v.validate("alice@")).not.toBeNull();
    });

    it("errors on missing local-part", () => {
        expect(v.validate("@example.com")).not.toBeNull();
    });

    it("throws for undefined (validator library enforces string type)", () => {
        // The `validator` library's `isEmail` calls `assertString` internally,
        // which throws a TypeError for non-string inputs rather than returning
        // false. EmailValidator does not guard against this, so callers must
        // ensure a string value before calling validate().
        expect(() => v.validate(undefined as unknown as string)).toThrow();
    });

    it("errors on empty string", () => {
        expect(v.validate("")).not.toBeNull();
    });

    it("throws for a number (validator library enforces string type)", () => {
        expect(() => v.validate(42 as unknown as string)).toThrow();
    });
});

// ---------------------------------------------------------------------------
// ObjectValidator
// ---------------------------------------------------------------------------
describe("ObjectValidator", () => {
    interface TestShape {
        name: string;
        age: number;
    }

    it("returns null when all fields pass validation", () => {
        const validator = new ObjectValidator<TestShape>();
        validator.add("name", new StringValidator());
        validator.add("age", new NumberValidator());

        const obj = {name: "Alice", age: 30};
        expect(validator.validate(obj)).toBeNull();
    });

    it("returns a top-level error with children when a field fails", () => {
        const validator = new ObjectValidator<TestShape>();
        validator.add("name", new StringValidator());
        validator.add("age", new NumberValidator());

        const result = validator.validate({name: 123, age: 30});
        expect(result).not.toBeNull();
        expect(result?.error).toBe("Validation Error");
        expect(result?.children).toHaveLength(1);
        expect(result?.children[0]).toMatchObject({property: "name", error: "is not string"});
    });

    it("reports multiple field errors in children", () => {
        const validator = new ObjectValidator<TestShape>();
        validator.add("name", new StringValidator());
        validator.add("age", new NumberValidator());

        const result = validator.validate({name: 123, age: "not-a-number"});
        expect(result?.children).toHaveLength(2);
    });

    it("returns an error when input is not a plain object", () => {
        const validator = new ObjectValidator<TestShape>();
        validator.add("name", new StringValidator());

        expect(validator.validate("just a string")).toMatchObject({
            error: "Is not object",
            children: [],
        });
        expect(validator.validate(null)).toMatchObject({error: "Is not object"});
        expect(validator.validate(undefined)).toMatchObject({error: "Is not object"});
        expect(validator.validate(42)).toMatchObject({error: "Is not object"});
    });

    it("returns null for an empty object when no field validators are registered", () => {
        const emptyValidator = new ObjectValidator<Record<string, never>>();
        expect(emptyValidator.validate({})).toBeNull();
    });

    it("assigns the field key to the child error property", () => {
        const validator = new ObjectValidator<{email: string}>();
        validator.add("email", new EmailValidator());

        const result = validator.validate({email: "bad-email"});
        expect(result?.children[0]?.property).toBe("email");
    });
});
