import {Request} from "express";
import {Validator} from "../validator/Validator";

export interface IRouter<AuthType> {
    authenticate(request: Request): Promise<AuthType>;
    get<T, R>(
        path: string,
        requestHandler: (authType: AuthType, request: T) => Promise<R>,
        validator?: Validator<T>,
        permission?: { resource: string; action: string }
    ): void;
    post<T, R>(
        path: string,
        requestHandler: (authType: AuthType, request: T) => Promise<R>,
        validator?: Validator<T>,
        permission?: { resource: string; action: string }
    ): void;
    patch<T, R>(
        path: string,
        requestHandler: (authType: AuthType, request: T) => Promise<R>,
        validator?: Validator<T>,
        permission?: { resource: string; action: string }
    ): void;
    delete<T, R>(
        path: string,
        requestHandler: (authType: AuthType, request: T) => Promise<R>,
        validator?: Validator<T>,
        permission?: { resource: string; action: string }
    ): void;
}
