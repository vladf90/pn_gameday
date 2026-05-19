import axios, {AxiosRequestConfig} from "axios";

export class RequestClient {
    async get<ParamsType, ResponseType>(path: string, params?: ParamsType): Promise<ResponseType> {
        const config = this.prepareConfig("get", path, params)
        const response = await axios.request(config);
        return response.data.data;
    }

    async post<RequestType, ResponseType, ParamsType>(path: string, request: RequestType, params?: ParamsType): Promise<ResponseType> {
        const config = this.prepareConfig("post", path, params, request)
        const response = await axios.request(config);
        return response.data.data;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async postFormData<RequestType extends GenericFormData, ResponseType, ParamsType>(path: string, request: RequestType, _params?: ParamsType): Promise<ResponseType> {
        const form = new FormData();
        for (const [key, value] of Object.entries(request)) {
            form.append(key, value);
        }
        let headers: Record<string, string> = {
            'Content-Type': 'multipart/form-data'
        };

        const token = this.getToken();
        if (token != null) {
            headers = {
                ...headers,
                "Authorization": `Bearer ${token}`
            }
        }
        const response = await axios.post(path, form, {
            baseURL: '/api',
            headers: headers
        });
        return response.data.data;
    }

    private prepareConfig<ParamsType, RequestType>(method: string, path: string, params: ParamsType, request?: RequestType): AxiosRequestConfig {
        const config: AxiosRequestConfig = {
            method: method,
            baseURL: '/api',
            url: path,
            params: params,
            data: request
        }
        const token = this.getToken();
        if (token != null) {
            config.headers = {Authorization: `Bearer ${token}`}
        }
        return config;
    }

    private getToken() {
        return localStorage.getItem('token');
    }
}

interface GenericFormData {
    [key: string]: string | File
}
