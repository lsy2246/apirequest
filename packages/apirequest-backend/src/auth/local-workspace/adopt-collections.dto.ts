import { IsIn, IsString, IsJSON, MaxLength } from 'class-validator';
export class AdoptLocalCollectionsDto {
  @IsIn(['REST', 'GQL']) collectionType: 'REST' | 'GQL';
  @IsString() @IsJSON() @MaxLength(50 * 1024 * 1024) collectionsJSON: string;
}
