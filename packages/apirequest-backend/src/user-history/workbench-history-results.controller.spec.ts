import { ForbiddenException } from '@nestjs/common';
import { WorkbenchHistoryResultsController } from './workbench-history-results.controller';
import { WorkbenchHistoryResultsService } from './workbench-history-results.service';
import { InfraConfigService } from '../infra-config/infra-config.service';
import { PubSubService } from '../pubsub/pubsub.service';
import { LOCAL_WORKSPACE_UID } from '../auth/local-workspace/policy';

describe('local history recording recovery', () => {
  const infra = { enableHistory: jest.fn() };
  const pubsub = { publish: jest.fn() };
  const controller = new WorkbenchHistoryResultsController(
    {} as WorkbenchHistoryResultsService,
    infra as unknown as InfraConfigService,
    pubsub as unknown as PubSubService,
  );
  const request = (uid: string) =>
    ({ user: { uid } }) as Parameters<typeof controller.enableRecording>[0];

  beforeEach(() => jest.resetAllMocks());

  it('lets the local owner enable history and informs other clients', async () => {
    await expect(controller.enableRecording(request(LOCAL_WORKSPACE_UID))).resolves.toEqual({ enabled: true });
    expect(infra.enableHistory).toHaveBeenCalledTimes(1);
    expect(pubsub.publish).toHaveBeenCalledWith(
      'infra_config/USER_HISTORY_STORE_ENABLED/updated',
      'ENABLE',
    );
  });

  it('rejects a different owner before touching the recording policy', async () => {
    await expect(controller.enableRecording(request('other'))).rejects.toThrow(
      ForbiddenException,
    );
    expect(infra.enableHistory).not.toHaveBeenCalled();
    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it('does not announce success when saving the policy fails', async () => {
    infra.enableHistory.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );
    await expect(
      controller.enableRecording(request(LOCAL_WORKSPACE_UID)),
    ).rejects.toThrow('Database unavailable');
    expect(pubsub.publish).not.toHaveBeenCalled();
  });
});
