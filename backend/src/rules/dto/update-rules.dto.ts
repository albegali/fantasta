import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export enum CallOrderDto {
  fixed = 'fixed',
  free = 'free',
}

export enum StartPriceModeDto {
  fixed = 'fixed',
  quotation = 'quotation',
}

/** Rimborso degli svincoli di riparazione — vedi `ReleaseRefund` nel contratto. */
export enum ReleaseRefundDto {
  none = 'none',
  purchase = 'purchase',
  quotation = 'quotation',
  average = 'average',
}

export class RosterSlotsDto {
  @IsInt() @Min(0) P!: number;
  @IsInt() @Min(0) D!: number;
  @IsInt() @Min(0) C!: number;
  @IsInt() @Min(0) A!: number;
}

/**
 * Patch delle regole di lega — stessa forma di `AuctionRules` nel contratto
 * socket, così l'admin rimanda indietro esattamente ciò che legge dallo snapshot.
 */
export class UpdateRulesDto {
  @IsOptional() @IsString() leagueName?: string;
  @IsOptional() @IsString() auctionName?: string;
  @IsOptional() @IsInt() @Min(1) budget?: number;
  @IsOptional() @ValidateNested() @Type(() => RosterSlotsDto) rosterSlots?: RosterSlotsDto;
  @IsOptional() @IsEnum(CallOrderDto) callOrder?: CallOrderDto;
  @IsOptional() @IsInt() @Min(1) bidTimerSeconds?: number;
  @IsOptional() @IsEnum(StartPriceModeDto) startPriceMode?: StartPriceModeDto;
  @IsOptional() @IsInt() @Min(1) startPrice?: number;
  @IsOptional() @IsEnum(ReleaseRefundDto) releaseRefund?: ReleaseRefundDto;
}

export class SetTurnOrderDto {
  @IsArray() @ArrayUnique() @IsString({ each: true }) turnOrder!: string[];
}
