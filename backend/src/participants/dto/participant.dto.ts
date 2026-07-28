import { IsHexColor, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * L'admin crea le squadre a mano, spesso a raffica: tutti i campi sono opzionali
 * e il server mette dei default sensati. `POST /participants` con body `{}` è
 * legittimo — è il bottone "aggiungi squadra" della tab Lega.
 */
export class CreateParticipantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() teamName?: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsInt() @Min(0) budget?: number;
}

export class UpdateParticipantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() teamName?: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsInt() @Min(0) budget?: number;
}
