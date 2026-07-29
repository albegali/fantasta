import { applyDecorators } from '@nestjs/common';
import {
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Un URL d'avatar non deve superare questa lunghezza: è un link, non un'immagine. */
const AVATAR_URL_MAX = 2048;

/**
 * L'avatar è un **URL esterno** (decisione 3 di `PLAN.md`): nessun upload, nessuno
 * storage, costo zero. Si accettano solo `http`/`https` — il che esclude anche i
 * `data:` URI, che sarebbero un'immagine travestita da link e riporterebbero in DB
 * quel che si è scelto di non tenere. La stringa **vuota** è legittima: è il modo di
 * togliere la foto e tornare alle iniziali.
 */
function IsAvatarUrl(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    ValidateIf((_dto, value: unknown) => value !== ''),
    IsString(),
    MaxLength(AVATAR_URL_MAX),
    IsUrl({ protocols: ['http', 'https'], require_protocol: true }),
  );
}

/**
 * L'admin crea le squadre a mano, spesso a raffica: tutti i campi sono opzionali
 * e il server mette dei default sensati. `POST /participants` con body `{}` è
 * legittimo — è il bottone "aggiungi squadra" della tab Lega.
 */
export class CreateParticipantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() teamName?: string;
  @IsAvatarUrl() avatarUrl?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsInt() @Min(0) budget?: number;
}

export class UpdateParticipantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() teamName?: string;
  @IsAvatarUrl() avatarUrl?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsInt() @Min(0) budget?: number;
}
