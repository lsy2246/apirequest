import { mockDeep } from 'jest-mock-extended';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { UserRequestService } from 'src/user-request/user-request.service';
import { UserCollectionService } from 'src/user-collection/user-collection.service';
import { SortService } from './sort.service';
import { SortOptions } from 'src/types/SortOptions';
import * as E from 'fp-ts/Either';

const mockUserRequestService = mockDeep<UserRequestService>();
const mockUserCollectionService = mockDeep<UserCollectionService>();
const mockPubSub = mockDeep<PubSubService>();

const sortService = new SortService(
  mockUserCollectionService,
  mockUserRequestService,
  mockPubSub,
);

beforeEach(() => {
  mockPubSub.publish.mockClear();
});

describe('sortUserCollections', () => {
  it('should return left if userCollectionService.sortUserCollections fails', async () => {
    mockUserCollectionService.sortUserCollections.mockResolvedValue(
      E.left('user_coll/reordering_failed'),
    );
    const result = await sortService.sortUserCollections(
      'userID',
      'parentCollectionID',
      SortOptions.TITLE_ASC,
    );
    expect(result).toEqual(E.left('user_coll/reordering_failed'));
    expect(mockUserCollectionService.sortUserCollections).toHaveBeenCalledWith(
      'userID',
      'parentCollectionID',
      SortOptions.TITLE_ASC,
    );
  });

  it('should return left if userRequestService.sortUserRequests fails', async () => {
    mockUserCollectionService.sortUserCollections.mockResolvedValue(
      E.right(true),
    );
    mockUserRequestService.sortUserRequests.mockResolvedValue(
      E.left('user_coll/reordering_failed'),
    );
    const result = await sortService.sortUserCollections(
      'userID',
      'parentCollectionID',
      SortOptions.TITLE_ASC,
    );
    expect(result).toEqual(E.left('user_coll/reordering_failed'));
    expect(mockUserRequestService.sortUserRequests).toHaveBeenCalledWith(
      'userID',
      'parentCollectionID',
      SortOptions.TITLE_ASC,
    );
  });

  it('should publish root event if parentCollectionID is falsy', async () => {
    mockUserCollectionService.sortUserCollections.mockResolvedValue(
      E.right(true),
    );
    mockUserRequestService.sortUserRequests.mockResolvedValue(E.right(true));
    const result = await sortService.sortUserCollections(
      'userID',
      null,
      SortOptions.TITLE_ASC,
    );
    expect(mockPubSub.publish).toHaveBeenCalledWith(
      `user_coll_root/userID/sorted`,
      {
        parentCollectionID: null,
        sortOption: SortOptions.TITLE_ASC,
      },
    );
    expect(result).toEqual(E.right(true));
  });

  it('should publish child event if parentCollectionID is truthy', async () => {
    mockUserCollectionService.sortUserCollections.mockResolvedValue(
      E.right(true),
    );
    mockUserRequestService.sortUserRequests.mockResolvedValue(E.right(true));
    const result = await sortService.sortUserCollections(
      'userID',
      'parentCollectionID',
      SortOptions.TITLE_ASC,
    );
    expect(mockPubSub.publish).toHaveBeenCalledWith(
      `user_coll_child/userID/sorted`,
      {
        parentCollectionID: 'parentCollectionID',
        sortOption: SortOptions.TITLE_ASC,
      },
    );
    expect(result).toEqual(E.right(true));
  });
});
