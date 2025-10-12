import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { PARTICIPANT_STATUS } from '../../../types';

export const UpdateParticipantDtoSchema = z.object({
    status: z.nativeEnum(PARTICIPANT_STATUS).optional(),
});

export class UpdateParticipantDto extends createZodDto(
    UpdateParticipantDtoSchema
) {
    @ApiProperty({
        description:
            'Status: PENDING (0), APPROVED (1), REJECTED (2), or LEFT (3)',
        example: PARTICIPANT_STATUS.APPROVED,
        enum: PARTICIPANT_STATUS,
        required: false,
    })
    status?: PARTICIPANT_STATUS;
}
