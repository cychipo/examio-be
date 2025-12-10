import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

// Cheating violation types
export enum CHEATING_TYPE {
    TAB_SWITCH = 'TAB_SWITCH',
    WINDOW_BLUR = 'WINDOW_BLUR',
    DEVTOOLS_OPEN = 'DEVTOOLS_OPEN',
    COPY_PASTE = 'COPY_PASTE',
    RIGHT_CLICK = 'RIGHT_CLICK',
    FULLSCREEN_EXIT = 'FULLSCREEN_EXIT',
    PRINT_SCREEN = 'PRINT_SCREEN',
}

// Human-readable descriptions for each type
export const CHEATING_TYPE_DESCRIPTIONS: Record<CHEATING_TYPE, string> = {
    [CHEATING_TYPE.TAB_SWITCH]: 'Chuyển tab trình duyệt',
    [CHEATING_TYPE.WINDOW_BLUR]: 'Rời khỏi cửa sổ thi',
    [CHEATING_TYPE.DEVTOOLS_OPEN]: 'Mở công cụ phát triển (F12)',
    [CHEATING_TYPE.COPY_PASTE]: 'Sao chép/dán nội dung',
    [CHEATING_TYPE.RIGHT_CLICK]: 'Click chuột phải',
    [CHEATING_TYPE.FULLSCREEN_EXIT]: 'Thoát chế độ toàn màn hình',
    [CHEATING_TYPE.PRINT_SCREEN]: 'Chụp màn hình',
};

export const CreateCheatingLogSchema = z.object({
    examAttemptId: z
        .string()
        .min(1, { message: 'Exam attempt ID is required' }),
    type: z.nativeEnum(CHEATING_TYPE, {
        message: 'Invalid cheating type',
    }),
});

export class CreateCheatingLogDto extends createZodDto(
    CreateCheatingLogSchema
) {
    @ApiProperty({
        description: 'ID of the exam attempt',
        example: 'attempt_123456',
    })
    examAttemptId: string;

    @ApiProperty({
        description: 'Type of cheating violation',
        enum: CHEATING_TYPE,
        example: CHEATING_TYPE.TAB_SWITCH,
    })
    type: CHEATING_TYPE;
}
