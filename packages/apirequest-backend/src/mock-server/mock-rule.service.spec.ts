import { MockRuleService } from './mock-rule.service';

const legacyRule = () => ({
  id: 'rule-0001',
  name: 'Order',
  enabled: true,
  method: 'GET',
  path: '/order',
  conditions: [],
  exhausted: 'repeat_last',
  steps: [
    {
      action: 'http',
      statusCode: 200,
      body: '{}',
      headers: {},
      delayMs: null,
      times: 1,
      intervalMs: 0,
      disconnectAfter: false,
    },
  ],
});
function fixture() {
  const rule = legacyRule();
  const current = {
    kind: 'collection',
    revision: 1,
    rules: [rule],
    hits: { [rule.id]: 3 },
    states: { checkout: 'ready' },
  };
  const update = jest.fn().mockResolvedValue(undefined);
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ ruleSet: current }]),
    mockServer: { update },
  };
  const service = new MockRuleService({
    $transaction: async (action: any) => action(tx),
  } as any);
  return { service, rule, update };
}
describe('Mock rule progress when editing', () => {
  it('preserves hit progress when pausing an older rule without advanced fields', async () => {
    const { service, rule } = fixture();
    const result = await service.save('server', 'owner', {
      revision: 1,
      rules: [{ ...rule, enabled: false }],
    });
    expect(result.hits).toEqual({ 'rule-0001': 3 });
    expect(result.states).toEqual({ checkout: 'ready' });
  });
  it('resets hit progress after changing the response', async () => {
    const { rule } = fixture();
    rule.steps[0].body = 'updated';
    // Keep the persisted snapshot independent from the edit.
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          ruleSet: {
            kind: 'collection',
            revision: 1,
            rules: [legacyRule()],
            hits: { 'rule-0001': 3 },
          },
        },
      ]),
      mockServer: { update: jest.fn().mockResolvedValue(undefined) },
    };
    const independent = new MockRuleService({
      $transaction: async (action: any) => action(tx),
    } as any);
    const result = await independent.save('server', 'owner', {
      revision: 1,
      rules: [rule],
    });
    expect(result.hits).toEqual({});
  });
});

describe('unsaved Mock previews', () => {
  it('previews drafts without database access', async () => {
    const service = new MockRuleService({} as any);
    const result = await service.preview({
      rules: [legacyRule()],
      request: { method: 'GET', path: '/order' },
    });
    expect(result.selection?.rule.id).toBe('rule-0001');
    expect(result.selection?.step.body).toBe('{}');
  });
});
