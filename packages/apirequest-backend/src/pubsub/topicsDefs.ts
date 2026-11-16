import { UserRequest, UserRequestReorderData } from 'src/user-request/user-request.model';
import { User } from 'src/user/user.model';
import { UserSettings } from 'src/user-settings/user-settings.model';
import { UserEnvironment } from '../user-environment/user-environments.model';
import { UserHistory, UserHistoryDeletedManyData } from '../user-history/user-history.model';
import { UserCollection, UserCollectionDuplicatedData, UserCollectionRemovedData, UserCollectionReorderData } from 'src/user-collection/user-collections.model';
import { UserCollectionSortData } from 'src/orchestration/sort/sort.model';
// A custom message type that defines the topic and the corresponding payload.
// For every module that publishes a subscription add its type def and the possible subscription type.
export type TopicDef = {
  [topic: `user/${string}/${'updated' | 'deleted'}`]: User;
  [topic: `user_settings/${string}/${'created' | 'updated'}`]: UserSettings;
  [
    topic: `user_environment/${string}/${'created' | 'updated' | 'deleted'}`
  ]: UserEnvironment;
  [topic: `user_environment/${string}/deleted_many`]: number;
  [
    topic: `user_request/${string}/${'created' | 'updated' | 'deleted'}`
  ]: UserRequest;
  [topic: `user_request/${string}/${'moved'}`]: UserRequestReorderData;
  [topic: `user_history/${string}/${'created' | 'updated' | 'deleted'}`]:
    UserHistory | boolean;
  [topic: `user_history/${string}/deleted_many`]: UserHistoryDeletedManyData;
  [
    topic: `user_coll/${string}/${'created' | 'updated' | 'moved'}`
  ]: UserCollection;
  [topic: `user_coll/${string}/${'duplicated'}`]: UserCollectionDuplicatedData;
  [topic: `user_coll/${string}/${'deleted'}`]: UserCollectionRemovedData;
  [topic: `user_coll/${string}/${'order_updated'}`]: UserCollectionReorderData;
  [topic: `user_coll_root/${string}/${'sorted'}`]: UserCollectionSortData;
  [topic: `user_coll_child/${string}/${'sorted'}`]: UserCollectionSortData;
  [topic: `infra_config/${string}/${'updated'}`]: string;
};
