export interface PaginationRequest {
    pagination: PaginationDetail;
    sort: SortDetail;
    filter?: Record<string, unknown>;
}

export interface PaginationDetail {
    page: number;
    perPage: number;
}

export interface SortDetail {
    field: string;
    order: string;
}
