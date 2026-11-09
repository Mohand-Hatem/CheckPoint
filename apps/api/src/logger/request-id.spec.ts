import { IncomingMessage, ServerResponse } from 'http';
import { requestId } from './request-id';

describe('requestId (Phase 1: request ID)', () => {
  const call = (header?: string) => {
    const res = { setHeader: jest.fn() };
    const id = requestId(
      { headers: header === undefined ? {} : { 'x-request-id': header } } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    );
    return { id, res };
  };

  it('reuses a safe incoming X-Request-Id and echoes it back', () => {
    const { id, res } = call('abc-123_DEF.9');
    expect(id).toBe('abc-123_DEF.9');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'abc-123_DEF.9');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['unsafe characters', 'abc\n{"evil":1}'],
    ['too long', 'a'.repeat(129)],
  ])('generates a UUID when the incoming id is %s', (_name, header) => {
    const { id, res } = call(header);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', id);
  });
});
