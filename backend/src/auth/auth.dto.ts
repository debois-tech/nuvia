import { IsString, Length, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(64) orgId: string;
  @IsString() @MinLength(1) @MaxLength(256) password: string;
}

export class CodeDto {
  /** A 6-digit authenticator code, or a recovery code such as ABCD-EFGH-JKLM. */
  @IsString() @Length(6, 20) code: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(256) currentPassword: string;
  @IsString() @MinLength(1) @MaxLength(256) newPassword: string;
}
