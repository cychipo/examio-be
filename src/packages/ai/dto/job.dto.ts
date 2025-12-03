export enum JobStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed',
}

export enum JobType {
    QUIZ = 'quiz',
    FLASHCARD = 'flashcard',
}

export interface JobResponse {
    jobId: string;
    status: JobStatus;
    message: string;
}

export interface JobStatusResponse {
    jobId: string;
    status: JobStatus;
    progress?: number; // 0-100
    message?: string;
    error?: string;
    result?: JobResult;
}

export interface JobResult {
    type: JobType;
    quizzes?: any[];
    flashcards?: any[];
    historyId?: string;
    fileInfo?: {
        id: string;
        filename: string;
    };
}

export interface Job {
    id: string;
    status: JobStatus;
    type: JobType;
    userId: string;
    file: Express.Multer.File | null; // null for regenerate jobs
    params: {
        quantityFlashcard?: number;
        quantityQuizz?: number;
        typeResult: number;
        isNarrowSearch?: boolean;
        keyword?: string;
        uploadId?: string; // For regenerate jobs
    };
    result?: JobResult;
    error?: string;
    progress: number;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
}
