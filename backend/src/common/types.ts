export interface ListRequest {
    pagination: PaginationDetail;
    sort: SortDetail;
    filter: FilterRequest;
}

export interface FilterRequest {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [t: string]: any;
}

export interface PaginationDetail {
    page: number;
    perPage: number;
}

export interface SortDetail {
    field: string;
    order: string;
}

export interface ListResponse<DataType> {
    list: DataType[];
    total?: number;
}

export interface StatusResponse {
    status: boolean;
}
