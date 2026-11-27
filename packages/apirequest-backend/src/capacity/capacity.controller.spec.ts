import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LOCAL_WORKSPACE_UID } from 'src/auth/local-workspace/policy';
import { CapacityController } from './capacity.controller';
import type { CapacityService } from './capacity.service';

describe('capacity settings access', () => {
  const origin = 'http://192.168.1.68:3300';
  const overrides = { detailBatchSize: 199 };
  const body = { overrides, revision: 0 };

  function fixture(requestOrigin = origin, uid = LOCAL_WORKSPACE_UID) {
    const save = jest.fn().mockResolvedValue(undefined);
    const result = { revision: 1, values: overrides };
    const capacity = { save, view: jest.fn().mockReturnValue(result) };
    const config = new ConfigService({
      APIREQUEST_ALLOW_LAN_ACCESS: 'true',
      VITE_BASE_URL: origin,
      VITE_BACKEND_GQL_URL: `${origin}/graphql`,
    });
    const controller = new CapacityController(
      capacity as unknown as CapacityService,
      config,
    );
    const request = {
      headers: {
        host: '192.168.1.68:3300',
        origin: requestOrigin,
        'x-workbench-local': '1',
      },
      socket: { remoteAddress: '192.168.1.20' },
      secure: false,
      user: { uid },
    } as Parameters<CapacityController['write']>[0];
    return { controller, request, result, save };
  }

  it('saves over LAN HTTP using the workbench session alone', async () => {
    const { controller, request, result, save } = fixture();
    await expect(controller.write(request, body)).resolves.toEqual(result);
    expect(save).toHaveBeenCalledWith(LOCAL_WORKSPACE_UID, overrides, 0);
  });

  it.each([
    ['http://another-origin.test', LOCAL_WORKSPACE_UID],
    [origin, 'another-owner'],
  ])('rejects writes from %s as %s', async (requestOrigin, uid) => {
    const { controller, request, save } = fixture(requestOrigin, uid);
    await expect(controller.write(request, body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(save).not.toHaveBeenCalled();
  });
});
