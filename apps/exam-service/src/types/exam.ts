export enum ASSESS_TYPE {
    PUBLIC = 0,
    PRIVATE = 1,
}

export enum EXAM_SESSION_STATUS {
    UPCOMING = 0,
    ONGOING = 1,
    ENDED = 2,
}

export enum EXAM_ATTEMPT_STATUS {
    IN_PROGRESS = 0,
    COMPLETED = 1,
    CANCELLED = 2,
}

export enum PARTICIPANT_STATUS {
    PENDING = 0,
    APPROVED = 1,
    REJECTED = 2,
    LEFT = 3,
}

export enum QUIZ_PRACTICE_TYPE {
    PRACTICE = 0, // Thi thử
    REAL = 1, // Thi thật
}

export interface Quizz {
    question: string;
    options: string[];
    answer: string;
}

export interface Flashcard {
    question: string;
    answer: string;
}
