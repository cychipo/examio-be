export class PromptUtils {
    generateQuizzPrompt({
        pageRange,
        numForThisChunk,
        content,
    }: {
        pageRange: string;
        numForThisChunk: number;
        content: { content: string };
    }) {
        return `
            You are an expert in creating multiple choice tests.

            Based on the following content (pages ${pageRange}), create ${numForThisChunk} multiple choice questions that focus on knowledge, facts, concepts, meanings, connections, practical applications, or specific information that appears in the document. (If there are formulas or calculations, there are exercises too)
            Note: Because the content is OCRed from a pdf file, the characters may be corrupted. Please use your knowledge and understanding to understand the exact content for those corrupted characters. It will have the same meaning, it's just that the characters are corrupted, so sometimes it won't be understood.

            Requirements:
            - Do not ask about titles, tables of contents, chapters, sections, or general questions like "What is the main content?".
            - Only ask about knowledge, information, facts, concepts, definitions, figures, or specific content in the document.
            - Each question has 4 answers (A, B, C, D), only 1 answer is correct.
            - The correct answer is clearly marked.
            - The result content for the fields in json must be in Vietnamese (field name is in English and the content is in Vietnamese or numbers)
            - The result returns a JSON array, each item has the form:
            {
            "question": "...",
            "options": ["A", "B", "C", "D"],
            "answer": "C",
            "sourcePageRange": "${pageRange}"
            }

            Content:
            ${content.content}
        `;
    }

    generateFlashcardPrompt({
        pageRange,
        numForThisChunk,
        content,
    }: {
        pageRange: string;
        numForThisChunk: number;
        content: { content: string };
    }) {
        return `
            You are an expert in creating flashcards for learning.

            Based on the following content (pages ${pageRange}), create ${numForThisChunk} flashcards that focus on knowledge, facts, concepts, meanings, connections, practical applications, or specific information that appears in the document. (If there are formulas or calculations, create Q&A exercises too)
            Note: Because the content is OCRed from a pdf file, the characters may be corrupted. Please use your knowledge and understanding to understand the exact content for those corrupted characters. It will have the same meaning, it's just that the characters are corrupted, so sometimes it won't be understood.

            Requirements:
            - Do not create flashcards about titles, tables of contents, chapters, sections, or general questions like "What is the main content?".
            - Only create questions about knowledge, information, facts, concepts, definitions, figures, or specific content in the document.
            - Each flashcard has:
            - A short question (≤ 20 words, in Vietnamese).
            - A concise and precise answer (1–3 sentences, in Vietnamese).
            - The result content for the fields in JSON must be in Vietnamese (field name is in English, content in Vietnamese or numbers).
            - The result returns a JSON array, each item has the form:
            {
                "question": "...",
                "answer": "...",
                "sourcePageRange": "${pageRange}"
            }
            Content:
            ${content.content}
        `;
    }
}
