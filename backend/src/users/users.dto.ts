import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ROLES, Role } from '../rbac/roles';

export const ORG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;

export class CreateUserDto {
  @IsString() @Matches(ORG_ID_PATTERN, { message: 'orgId must be 3-32 characters: letters, digits, dot, dash, underscore' })
  orgId: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsEmail() @MaxLength(200) email: string;
  @IsIn(ROLES) role: Role;
  @IsOptional() @IsString() @MaxLength(60) title?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsIn(ROLES) role?: Role;
  @IsOptional() @IsString() @MaxLength(60) title?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
