import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const maximumTransferSize = 50 * 1024 * 1024;

export class CreateTransferFileDto {
  @IsInt()
  @Min(0)
  @Max(maximumTransferSize)
  size!: number;
}

export class CreateTransferDto {
  @IsInt()
  @IsIn([1, 3, 5, 10])
  durationDays!: number;

  @IsInt()
  @Min(0)
  @Max(maximumTransferSize)
  totalSize!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateTransferFileDto)
  files!: CreateTransferFileDto[];
}

export class OpaqueRegistrationStartDto {
  @IsString()
  @MaxLength(10000)
  registrationRequest!: string;
}

export class CompleteTransferDto {
  @IsString()
  @MaxLength(10000)
  registrationRecord!: string;

  @IsString()
  @MaxLength(10000)
  encryptedKeyEnvelope!: string;

  @IsString()
  @MaxLength(200000)
  encryptedMetadata!: string;
}

export class ReceiveCodeStartDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @IsString()
  @MaxLength(10000)
  startLoginRequest!: string;
}

export class ReceiveCodeFinishDto {
  @IsString()
  @Matches(/^[0-9a-f-]{36}$/i)
  sessionId!: string;

  @IsString()
  @MaxLength(10000)
  finishLoginRequest!: string;
}