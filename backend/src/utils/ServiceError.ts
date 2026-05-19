export class ServiceError extends Error {
    private readonly statusCode: number;
    private readonly info: ServiceErrorInfo;

    constructor(message: string, statusCode: number, info?: ServiceErrorInfo) {
        super(message);
        this.name = "ServiceError";
        this.statusCode = statusCode;
        this.info = info;
    }

    public getStatusCode() {
        return this.statusCode;
    }

    public getInfo() {
        return this.info;
    }

    public static build(message: string, statusCode: number, info?: ServiceErrorInfo) {
        return new ServiceError(message, statusCode, info);
    }
}

interface ServiceErrorInfo {
    [key: string]: unknown;
}
