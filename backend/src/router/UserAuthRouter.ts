import {BaseRouter} from "./BaseRouter";
import {Application, Request} from "express";
import * as jwt from "jsonwebtoken";
import {ServiceError} from "../utils/ServiceError";
import * as HttpStatus from 'http-status-codes'

export class UserAuthRouter extends BaseRouter<UserAuth> {
    constructor(
        readonly app: Application,
        private readonly publicKey: Buffer) {
        super(app);
    }

    async authenticate(request: Request): Promise<UserAuth> {
        const authorization = request.get("Authorization");
        if (authorization == null) {
            throw ServiceError.build("Missing Authorization header", HttpStatus.UNAUTHORIZED);
        }

        const splitAuthorization = authorization.split(" ");
        let token: string | null = null;
        if (splitAuthorization.length === 2) {
            token = splitAuthorization[1];
        }
        if (token == null) {
            throw ServiceError.build("Invalid authorization header", HttpStatus.UNAUTHORIZED);
        }
        try {
            return await jwt.verify(token, this.publicKey) as UserAuth;
        } catch (e) {
            throw ServiceError.build("Could not verify token", HttpStatus.UNAUTHORIZED);
        }
    }
}

export interface UserAuth {
    id: number;
    username: string;
    role: string;
    permissions: string[];
}
