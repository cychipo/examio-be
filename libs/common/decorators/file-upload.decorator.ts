import { applyDecorators } from '@nestjs/common';
import { ApiConsumes, ApiBody } from '@nestjs/swagger';

export function ApiFile(fieldName = 'file') {
    return applyDecorators(
        ApiConsumes('multipart/form-data'),
        ApiBody({
            schema: {
                type: 'object',
                properties: {
                    [fieldName]: {
                        type: 'string',
                        format: 'binary',
                    },
                    quantityQuizz: {
                        type: 'number',
                        description: 'Number of quiz questions to generate',
                        example: 5,
                    },
                    quantityFlashcard: {
                        type: 'number',
                        description: 'Number of flashcards to generate',
                        example: 5,
                    },
                    typeResult: {
                        type: 'number',
                        description: '1: Quiz, 2: Flashcard',
                        example: 1,
                    },
                    isNarrowSearch: {
                        type: 'boolean',
                        description:
                            'Whether to use narrow search for relevant chunks',
                        example: false,
                    },
                    keyword: {
                        type: 'string',
                        description:
                            'Additional prompt to guide the generation process',
                        example: 'Create quiz questions based on the content',
                    },
                },
            },
        })
    );
}

export function ApiFiles(fieldName = 'files') {
    return applyDecorators(
        ApiConsumes('multipart/form-data'),
        ApiBody({
            schema: {
                type: 'object',
                properties: {
                    [fieldName]: {
                        type: 'array',
                        items: {
                            type: 'string',
                            format: 'binary',
                        },
                    },
                    quantityQuizz: {
                        type: 'number',
                        description: 'Number of quiz questions to generate',
                        example: 5,
                    },
                    quantityFlashcard: {
                        type: 'number',
                        description: 'Number of flashcards to generate',
                        example: 5,
                    },
                    typeResult: {
                        type: 'number',
                        description: '1: Quiz, 2: Flashcard',
                        example: 1,
                    },
                    isNarrowSearch: {
                        type: 'boolean',
                        description:
                            'Whether to use narrow search for relevant chunks',
                        example: false,
                    },
                    keyword: {
                        type: 'string',
                        description:
                            'Additional prompt to guide the generation process',
                        example: 'Create quiz questions based on the content',
                    },
                },
            },
        })
    );
}
