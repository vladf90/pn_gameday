export enum ContextType {
    TYPE_PROCESS = "process",
    TYPE_REQUEST = "request"
}

export interface RequestContext extends BaseContext {
    path: string;
    type: ContextType.TYPE_REQUEST;
    method: string;
    timestamp: Date;
}

export interface ProcessContext extends BaseContext {
    type: ContextType.TYPE_PROCESS
}

export interface BaseContext {
    service: string;
}

export type ContextUnion = ProcessContext | RequestContext;

export class ContextFactory {
    public static createProcessContext(service: string): Context {
        return new Context({service, type: ContextType.TYPE_PROCESS});
    }

    public static createRequestContext(path, service, method): Context {
        return new Context({path, service, type: ContextType.TYPE_REQUEST, method, timestamp: new Date()});
    }
}

export class Context {
    constructor(private readonly context: ContextUnion) {
    }

    format(): string {
        switch (this.context.type) {
            case ContextType.TYPE_PROCESS:
                return "";
            case ContextType.TYPE_REQUEST:
                return `${this.context.method} ${this.context.path} `
        }
    }

    getContext() {
        return this.context;
    }
}
