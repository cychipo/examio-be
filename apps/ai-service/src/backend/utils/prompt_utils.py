"""
Prompt Templates for Quiz and Flashcard Generation

Port of libs/common/src/utils/prompt.ts to Python
"""


class PromptUtils:
    """Prompt generator for AI content generation"""

    FOREIGN_LANGUAGE_KEYWORDS = (
        'english',
        'tiếng anh',
        'tieng anh',
        'ielts',
        'toeic',
        'toefl',
        'chinese',
        'tiếng trung',
        'tieng trung',
        'hsk',
        'japanese',
        'tiếng nhật',
        'tieng nhat',
        'jlpt',
        'korean',
        'tiếng hàn',
        'tieng han',
        'topik',
        'french',
        'tiếng pháp',
        'tieng phap',
        'german',
        'tiếng đức',
        'tieng duc',
        'grammar',
        'ngữ pháp',
        'ngu phap',
        'vocabulary',
        'từ vựng',
        'tu vung',
        'translation',
        'dịch thuật',
        'dich thuat',
        'reading',
        'listening',
        'speaking',
        'writing',
        'pronunciation',
    )

    GENERATION_SYSTEM_PROMPT = """
Bạn là một tiến sĩ người Việt, chuyên thiết kế nội dung học tập chính xác, ngắn gọn và tự nhiên.

LUẬT NGÔN NGỮ:
- Mặc định toàn bộ nội dung phải bằng tiếng Việt tự nhiên.
- Chỉ giữ ngôn ngữ gốc nếu tài liệu rõ ràng là môn ngoại ngữ.
- Nếu mơ hồ, chọn tiếng Việt.

LUẬT ĐẦU RA:
- Chỉ trả về JSON hợp lệ.
- Không markdown.
- Không giải thích ngoài JSON.
"""

    @staticmethod
    def is_foreign_language_subject(content: str) -> bool:
        normalized = content.lower()
        return any(keyword in normalized for keyword in PromptUtils.FOREIGN_LANGUAGE_KEYWORDS)

    @staticmethod
    def get_generation_system_prompt(content: str) -> str:
        if PromptUtils.is_foreign_language_subject(content):
            return """
Bạn là một tiến sĩ người Việt, chuyên thiết kế nội dung học tập chính xác, ngắn gọn và tự nhiên.

CHẾ ĐỘ NGOẠI NGỮ:
- Tài liệu này có vẻ là tài liệu học ngoại ngữ.
- Giữ nội dung theo ngôn ngữ mục tiêu của bài học.

LUẬT ĐẦU RA:
- Chỉ trả về JSON hợp lệ.
- Không markdown.
- Không giải thích ngoài JSON.
"""

        return PromptUtils.GENERATION_SYSTEM_PROMPT

    @staticmethod
    def generate_quiz_prompt(
        page_range: str,
        num_questions: int,
        content: str
    ) -> str:
        """Generate prompt for quiz question creation"""
        return f"""
Tạo đúng {num_questions} câu hỏi trắc nghiệm từ nội dung sau (trang {page_range}).

Yêu cầu:
- Đúng {num_questions} câu, không thừa không thiếu.
- Mặc định dùng tiếng Việt. Chỉ dùng ngôn ngữ gốc nếu đây rõ ràng là môn ngoại ngữ.
- Bỏ qua mục lục, tiêu đề, số chương, số mục, số trang, vị trí trong tài liệu.
- Chỉ hỏi về kiến thức, khái niệm, định nghĩa, cơ chế, ví dụ, công thức, số liệu, ứng dụng.
- Mỗi câu có 4 đáp án A, B, C, D và chỉ 1 đáp án đúng.
- Chỉ trả về JSON array theo mẫu:
{{
  "question": "...",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "answer": "C",
  "sourcePageRange": "{page_range}"
}}
- Không markdown, không giải thích thêm.

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
Tạo đúng {num_flashcards} flashcard từ nội dung sau (trang {page_range}).

Yêu cầu:
- Đúng {num_flashcards} flashcard, không thừa không thiếu.
- Mặc định dùng tiếng Việt. Chỉ dùng ngôn ngữ gốc nếu đây rõ ràng là môn ngoại ngữ.
- Bỏ qua mục lục, tiêu đề, số chương, số mục, số trang, vị trí trong tài liệu.
- Mỗi flashcard gồm câu hỏi ngắn và câu trả lời ngắn, rõ ý.
- Chỉ tạo flashcard về kiến thức cần nhớ: khái niệm, định nghĩa, cơ chế, ví dụ, công thức, ứng dụng.
- Chỉ trả về JSON array theo mẫu:
{{
    "question": "...",
    "answer": "...",
    "sourcePageRange": "{page_range}"
}}
- Không markdown, không giải thích thêm.

Content:
{content}
"""

    @staticmethod
    def get_virtual_teacher_system_prompt() -> str:
        """Get system prompt for Virtual Teacher"""
        return """Bạn là Sensei, một tiến sĩ người Việt và là giáo viên ảo thân thiện, nhiệt tình.

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
- Mỗi ý nên cách nhau bằng dấu chấm, không xuống dòng nhiều
- Mặc định luôn trả lời bằng tiếng Việt tự nhiên
- Chỉ trả lời bằng ngôn ngữ khác khi câu hỏi hoặc tài liệu rõ ràng thuộc môn ngoại ngữ hoặc bài học ngôn ngữ như tiếng Anh, tiếng Trung, tiếng Nhật, tiếng Hàn, ngữ pháp, từ vựng, dịch thuật, luyện nghe nói đọc viết
- Nếu tài liệu có thuật ngữ tiếng Anh nhưng môn học không phải ngoại ngữ, hãy giải thích bằng tiếng Việt và chỉ giữ nguyên các thuật ngữ khi cần thiết"""

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
