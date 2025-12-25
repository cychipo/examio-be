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
            - The result content for the fields in json must be in Vietnamese (field name is in English and the content is in Vietnamese or numbers). Except in the case where the uploaded file is for a foreign language subject (for example, English, Korean, ...). It must be the question in the original language in the file (note that it is the question for a foreign language subject such as English, Chinese, ... and not based on the language in the file).
            - The result returns a JSON array, each item has the form:
            {
            "question": "...",
            "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
            "answer": "C",
            "sourcePageRange": "${pageRange}"
            }
            - Note that each answer must have the letter A/B/C/D at the beginning, not missing
            - The correct answer only needs the letter A/B/C/D at the beginning, not the answer content

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
            - The result content for the fields in JSON must be in Vietnamese (field name is in English, content in Vietnamese or numbers). Except in the case where the uploaded file is for a foreign language subject (for example, English, Korean, ...). It must be the question in the original language in the file (note that it is the question for a foreign language subject such as English, Chinese, ... and not based on the language in the file).
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

    /**
     * Build system prompt for Virtual Teacher
     */
    getVirtualTeacherSystemPrompt(): string {
        return `Bạn là một giáo viên ảo thân thiện và nhiệt tình. Bạn có tên là Sensei.

NHIỆM VỤ:
- Giải thích kiến thức một cách dễ hiểu, sử dụng ví dụ thực tế
- Trả lời ngắn gọn, súc tích, phù hợp để đọc bằng giọng nói
- Khuyến khích và động viên học sinh

PHONG CÁCH:
- Thân thiện, gần gũi như một người thầy/cô tốt bụng
- Sử dụng ngôn ngữ tự nhiên, dễ nghe
- Tránh các thuật ngữ quá chuyên môn khi không cần thiết
- Gọi tên học sinh khi trả lời câu hỏi. Danh xưng người hỏi là em. Còn bạn là Sensei

QUY TẮC QUAN TRỌNG:
- KHÔNG sử dụng markdown (**, ##, -, bullet points)
- KHÔNG sử dụng ký tự đặc biệt hoặc emoji
- Viết thành các câu hoàn chỉnh, tự nhiên
- Mỗi ý nên cách nhau bằng dấu chấm, không xuống dòng nhiều`;
    }

    /**
     * Build full prompt for Virtual Teacher with or without document context
     */
    buildVirtualTeacherPrompt(
        message: string,
        documentContext: string | null
    ): string {
        const systemPrompt = this.getVirtualTeacherSystemPrompt();

        if (documentContext) {
            return `${systemPrompt}

TÀI LIỆU THAM KHẢO:
${documentContext}

CÂU HỎI CỦA HỌC SINH: ${message}

TRẢ LỜI:`;
        }

        return `${systemPrompt}

CÂU HỎI CỦA HỌC SINH: ${message}

TRẢ LỜI:`;
    }
}
