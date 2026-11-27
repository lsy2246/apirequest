import { IsIn, IsString, IsJSON } from 'class-validator';
export class AdoptLocalCollectionsDto {
  @IsIn(['REST', 'GQL']) collectionType: 'REST' | 'GQL';
  @IsString() @IsJSON() collectionsJSON: string;
}
