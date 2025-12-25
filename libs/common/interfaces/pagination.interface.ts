export interface PaginationParams {
    page?: number;
    size?: number;
    sortBy?: string;
    sortType?: 'asc' | 'desc';
    dateFrom?: string;
    dateTo?: string;
    searchBy?: string[];
    text?: string;
    [key: string]: any;
}

export interface PaginationResult<T> {
    data: T[];
    total: number;
    page: number;
    size: number;
    totalPages: number;
}
