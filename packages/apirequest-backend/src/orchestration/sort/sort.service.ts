import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { SortOptions } from 'src/types/SortOptions';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { UserRequestService } from 'src/user-request/user-request.service';
import { UserCollectionService } from 'src/user-collection/user-collection.service';
@Injectable()
export class SortService {
  constructor(
    private readonly userCollectionService: UserCollectionService,
    private readonly userRequestService: UserRequestService,
    private readonly pubsub: PubSubService,
  ) {}
  async sortUserCollections(
    userID: string,
    parentCollectionID: string,
    sortOption: SortOptions,
  ) {
    const isCollectionSorted =
      await this.userCollectionService.sortUserCollections(
        userID,
        parentCollectionID,
        sortOption,
      );
    if (E.isLeft(isCollectionSorted)) return E.left(isCollectionSorted.left);
    const isRequestSorted = await this.userRequestService.sortUserRequests(
      userID,
      parentCollectionID,
      sortOption,
    );
    if (E.isLeft(isRequestSorted)) return E.left(isRequestSorted.left);
    // Publish the sort event
    if (!parentCollectionID) {
      this.pubsub.publish(`user_coll_root/${userID}/sorted`, {
        parentCollectionID,
        sortOption,
      });
    } else {
      this.pubsub.publish(`user_coll_child/${userID}/sorted`, {
        parentCollectionID,
        sortOption,
      });
    }
    return E.right(true);
  }
}
