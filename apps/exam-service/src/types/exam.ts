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

// Question selection modes for exam sessions
export enum QUESTION_SELECTION_MODE {
    ALL = 0, // Use all questions from the quiz set
    RANDOM_TOTAL = 1, // Randomly select N questions from total
    RANDOM_BY_LABEL = 2, // Randomly select questions based on label configuration
}

// Configuration for label-based question selection
export interface LabelQuestionConfig {
    labelId: string; // Label ID (use 'unlabeled' for questions without label)
    count: number; // Number of questions to randomly select from this label
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
