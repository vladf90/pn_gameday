import {Logger} from "../Logger";
import * as bcrypt from "bcrypt"
import {UserRepository, UserPassword} from "../database/repositories/UserRepository";
import * as jwt from "jsonwebtoken";
import {UserAuth} from "../router/UserAuthRouter";
import {ServiceError} from "../utils/ServiceError";
import * as HttpStatusCodes from "http-status-codes";
import {ObjectValidator} from "../validator/ObjectValidator";
import {StringValidator} from "../validator/StringValidator";
import {EmailValidator} from "../validator/EmailValidator";
import {getPermissionStrings} from "../config/permissions";

export class UserController {
    private readonly logger = new Logger("UserController");

    constructor(
        private readonly userRepository: UserRepository,
        private readonly privateKey: Buffer) {
    }

    get = async (auth: UserAuth): Promise<GetUserResponse> => {
        const userResult = await this.userRepository.getUserById(auth.id);
        if (!userResult) {
            throw ServiceError.build("User not found", HttpStatusCodes.NOT_FOUND);
        }
        return userResult;
    };

    login = async (_: void, request: LoginRequest): Promise<LoginResponse> => {
        const userResult: UserPassword = await this.userRepository.getUser(request.username);
        if (userResult === undefined) {
            throw ServiceError.build("Authentication failed.", HttpStatusCodes.UNAUTHORIZED);
        }

        const isMatch = await bcrypt.compare(request.password, userResult.password);
        if (!isMatch) {
            throw ServiceError.build("Authentication failed.", HttpStatusCodes.UNAUTHORIZED);
        }

        const permissions = getPermissionStrings(userResult.role);
        const userDetails = await this.userRepository.getUserById(userResult.id);

        const token = jwt.sign({
            username: userResult.username,
            id: userResult.id,
            role: userResult.role,
            permissions: permissions
        }, this.privateKey, {algorithm: "RS256"});

        return {
            id: userResult.id,
            token: token,
            role: userResult.role,
            permissions: permissions,
            firstName: userDetails?.firstName || '',
            lastName: userDetails?.lastName || '',
        };
    }
}

interface LoginRequest {
    username: string;
    password: string;
}

interface LoginResponse {
    id: number;
    token: string;
    role: string;
    permissions: string[];
    firstName: string;
    lastName: string;
}

interface GetUserResponse {
    id: number;
    username: string;
    firstName: string;
    lastName: string;
}

export class LoginValidator extends ObjectValidator<LoginRequest> {
    constructor() {
        super();
        this.add("username", new EmailValidator());
        this.add("password", new StringValidator());
    }
}
