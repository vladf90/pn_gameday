/**
 * Exemplar backend pure-unit test (introduced by ADR 0009 / issue #93).
 *
 * Two patterns demonstrated side-by-side:
 *
 * 1. `LoginValidator` — an `ObjectValidator` subclass. Tests run the validator
 *    directly against shaped inputs; no mocking required.
 *
 * 2. `UserController.login` — a controller method that depends on a repository,
 *    `bcrypt`, and `jsonwebtoken`. The repository is injected as a plain stub
 *    (lighter than `vi.mock`); the module-level `bcrypt`/`jsonwebtoken`
 *    imports are mocked with `vi.mock` so we never touch real crypto.
 *
 * Copy this file as the template when adding new controller tests.
 */
import {beforeEach, describe, expect, it, vi} from "vitest";
import * as bcrypt from "bcrypt";
import * as jwt from "jsonwebtoken";

import {LoginValidator, UserController} from "./UserController";
import type {UserRepository, UserPassword} from "../database/repositories/UserRepository";
import {ServiceError} from "../utils/ServiceError";

vi.mock("bcrypt", () => ({compare: vi.fn()}));
vi.mock("jsonwebtoken", () => ({sign: vi.fn()}));

describe("LoginValidator", () => {
    const validator = new LoginValidator();

    it("returns no error for a valid email + password", () => {
        expect(validator.validate({username: "alice@example.com", password: "hunter2"})).toBeNull();
    });

    it("flags a non-email username", () => {
        const result = validator.validate({username: "alice", password: "hunter2"});
        expect(result).not.toBeNull();
        expect(result?.children).toHaveLength(1);
        expect(result?.children[0]).toMatchObject({property: "username", error: "is not email"});
    });

    it("flags a non-string password", () => {
        const result = validator.validate({username: "alice@example.com", password: 12345});
        expect(result).not.toBeNull();
        expect(result?.children).toHaveLength(1);
        expect(result?.children[0]).toMatchObject({property: "password", error: "is not string"});
    });

    it("returns a top-level error when the input is not an object", () => {
        expect(validator.validate("not an object")).toMatchObject({error: "Is not object", children: []});
    });
});

describe("UserController.login", () => {
    // A plain stub is sufficient — only the methods the controller calls
    // need to exist. Casting to `UserRepository` keeps the controller
    // constructor signature satisfied.
    const repo = {
        getUser: vi.fn(),
        getUserById: vi.fn(),
    };
    const privateKey = Buffer.from("test-private-key");
    const controller = new UserController(repo as unknown as UserRepository, privateKey);

    const userPassword: UserPassword = {
        id: 7,
        username: "alice@example.com",
        password: "hashed-pw",
        role: "user",
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns a signed token + permissions on a valid login", async () => {
        repo.getUser.mockResolvedValueOnce(userPassword);
        repo.getUserById.mockResolvedValueOnce({
            id: 7,
            username: "alice@example.com",
            firstName: "Alice",
            lastName: "Anderson",
            avatarUrl: "",
        });
        vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
        vi.mocked(jwt.sign).mockReturnValueOnce("signed.jwt.token" as never);

        const response = await controller.login(undefined, {
            username: "alice@example.com",
            password: "hunter2",
        });

        expect(response).toEqual({
            id: 7,
            token: "signed.jwt.token",
            role: "user",
            permissions: expect.arrayContaining(["session:read", "fixture:read"]),
            firstName: "Alice",
            lastName: "Anderson",
        });
        expect(bcrypt.compare).toHaveBeenCalledWith("hunter2", "hashed-pw");
        expect(jwt.sign).toHaveBeenCalledWith(
            expect.objectContaining({id: 7, role: "user"}),
            privateKey,
            {algorithm: "RS256"},
        );
    });

    it("throws 401 ServiceError when the user does not exist", async () => {
        repo.getUser.mockResolvedValueOnce(undefined);

        await expect(
            controller.login(undefined, {username: "ghost@example.com", password: "x"}),
        ).rejects.toMatchObject({
            name: "ServiceError",
            message: "Authentication failed.",
        });
        expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it("throws 401 ServiceError when the password does not match", async () => {
        repo.getUser.mockResolvedValueOnce(userPassword);
        vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

        const promise = controller.login(undefined, {
            username: "alice@example.com",
            password: "wrong",
        });

        await expect(promise).rejects.toBeInstanceOf(ServiceError);
        await expect(promise).rejects.toMatchObject({message: "Authentication failed."});
        expect(jwt.sign).not.toHaveBeenCalled();
    });
});
