import {RequestClient} from "./RequestClient";

export class AuthRequestClient extends RequestClient {
    async login(request: LoginRequest): Promise<LoginResponse> {
        return await this.post<LoginRequest, LoginResponse, void>("/auth/login", request);
    }
}

interface LoginRequest {
    username: string;
    password: string;
}

interface LoginResponse {
    token: string;
    permissions: string[];
    firstName: string;
    lastName: string;
}
