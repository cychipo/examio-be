"""
Prompt Templates for Quiz and Flashcard Generation

Port of libs/common/src/utils/prompt.ts to Python
"""


class PromptUtils:
    """Prompt generator for AI content generation"""

    @staticmethod
    def generate_quiz_prompt(
        page_range: str,
        num_questions: int,
        content: str
    ) -> str:
        """Generate prompt for quiz question creation"""
        return f"""
You are an expert in creating multiple choice tests.

Based on the following content (pages {page_range}), create {num_questions} multiple choice questions that focus on knowledge, facts, concepts, meanings, connections, practical applications, or specific information that appears in the document. (If there are formulas or calculations, there are exercises too)
Note: Because the content is OCRed from a pdf file, the characters may be corrupted. Please use your knowledge and understanding to understand the exact content for those corrupted characters. It will have the same meaning, it's just that the characters are corrupted, so sometimes it won't be understood.

Requirements:
- Do not ask about titles, tables of contents, chapters, sections, or general questions like "What is the main content?".
- Only ask about knowledge, information, facts, concepts, definitions, figures, or specific content in the document.
- Each question has 4 answers (A, B, C, D), only 1 answer is correct.
- The correct answer is clearly marked.
- The result content for the fields in json must be in Vietnamese (field name is in English and the content is in Vietnamese or numbers). Except in the case where the uploaded file is for a foreign language subject (for example, English, Korean, ...). It must be the question in the original language in the file (note that it is the question for a foreign language subject such as English, Chinese, ... and not based on the language in the file).
- The result returns a JSON array, each item has the form:
{{
  "question": "...",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "answer": "C",
  "sourcePageRange": "{page_range}"
}}
- Note that each answer must have the letter A/B/C/D at the beginning, not missing
- The correct answer only needs the letter A/B/C/D at the beginning, not the answer content
- IMPORTANT: Return ONLY the JSON array, no explanation or markdown code blocks

Content:
{content}
"""

    @staticmethod
    def generate_flashcard_prompt(
        page_range: str,
        num_flashcards: int,
        content: str
    ) -> str:
        """Generate prompt for flashcard creation"""
        return f"""
You are an expert in creating flashcards for learning.

Based on the following content (pages {page_range}), create {num_flashcards} flashcards that focus on knowledge, facts, concepts, meanings, connections, practical applications, or specific information that appears in the document. (If there are formulas or calculations, create Q&A exercises too)
Note: Because the content is OCRed from a pdf file, the characters may be corrupted. Please use your knowledge and understanding to understand the exact content for those corrupted characters. It will have the same meaning, it's just that the characters are corrupted, so sometimes it won't be understood.

Requirements:
- Do not create flashcards about titles, tables of contents, chapters, sections, or general questions like "What is the main content?".
- Only create questions about knowledge, information, facts, concepts, definitions, figures, or specific content in the document.
- Each flashcard has:
  - A short question (≤ 20 words, in Vietnamese).
  - A concise and precise answer (1–3 sentences, in Vietnamese).
- The result content for the fields in JSON must be in Vietnamese (field name is in English, content in Vietnamese or numbers). Except in the case where the uploaded file is for a foreign language subject (for example, English, Korean, ...). It must be the question in the original language in the file (note that it is the question for a foreign language subject such as English, Chinese, ... and not based on the language in the file).
- The result returns a JSON array, each item has the form:
{{
    "question": "...",
    "answer": "...",
    "sourcePageRange": "{page_range}"
}}
- IMPORTANT: Return ONLY the JSON array, no explanation or markdown code blocks

Content:
{content}
"""

    @staticmethod
    def get_virtual_teacher_system_prompt() -> str:
        """Get system prompt for Virtual Teacher"""
        return """Bạn là một giáo viên ảo thân thiện và nhiệt tình. Bạn có tên là Sensei.

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
- Mỗi ý nên cách nhau bằng dấu chấm, không xuống dòng nhiều"""

    @staticmethod
    def build_virtual_teacher_prompt(
        message: str,
        document_context: str | None = None
    ) -> str:
        """Build full prompt for Virtual Teacher"""
        system_prompt = PromptUtils.get_virtual_teacher_system_prompt()

        if document_context:
            return f"""{system_prompt}

TÀI LIỆU THAM KHẢO:
{document_context}

CÂU HỎI CỦA HỌC SINH: {message}

TRẢ LỜI:"""

        return f"""{system_prompt}

CÂU HỎI CỦA HỌC SINH: {message}

TRẢ LỜI:"""


# Singleton instance
prompt_utils = PromptUtils()
